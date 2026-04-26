import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';
import { executeLayer1 } from '@/lib/layer1';
import { executeLayer2, buildCorrectedText } from '@/lib/layer2';
import { executeB1 } from '@/lib/conditions/b1';
import { executeB2 } from '@/lib/conditions/b2';
import { executeA1 } from '@/lib/conditions/a1';
import { executeA5 } from '@/lib/conditions/a5';
import type { Layer1Result } from '@/lib/layer1';
import type { Layer2Output } from '@/lib/layer2';

type ExperimentCondition =
  | 'B1'
  | 'B2'
  | 'B3'
  | 'proposed'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5';

const VALID_CONDITIONS: ExperimentCondition[] = [
  'B1', 'B2', 'B3', 'proposed', 'A1', 'A2', 'A3', 'A4', 'A5',
];

interface ExperimentResult {
  recordingId: string;
  domainId: string;
  condition: string;
  correctedText: string;
  segments: Array<{
    segmentIndex: number;
    originalText: string;
    correctedText: string;
    corrections: Array<{
      originalText: string;
      correctedTo: string;
      entityId: string;
      prefLabel: string;
      confidence: number;
      reasoning: string;
    }>;
  }>;
  stats: {
    totalSegments: number;
    segmentsProcessed: number;
    totalCorrections: number;
    layer1TimeMs: number;
    layer2TimeMs: number;
    totalTimeMs: number;
  };
}

export async function runExperiment(
  recordingId: string,
  domainId: string,
  condition: ExperimentCondition,
  segments: Array<{ text: string; start: number; end: number }>,
  snapshotWeek?: number
): Promise<ExperimentResult> {
  const totalStart = Date.now();
  let layer1TimeMs = 0;
  let layer2TimeMs = 0;
  let layer2Outputs: Layer2Output[] = [];
  let layer1Results: Layer1Result[] = [];
  let correctedText = '';

  if (condition === 'B1') {
    // B1: GPT-4o, 知識なし
    const l2Start = Date.now();
    layer2Outputs = await executeB1(segments);
    layer2TimeMs = Date.now() - l2Start;
    correctedText = buildCorrectedText(segments, layer2Outputs);

  } else if (condition === 'B2') {
    // B2: GPT-4o NER + 訂正（オントロジーなし）
    const l2Start = Date.now();
    layer2Outputs = await executeB2(segments);
    layer2TimeMs = Date.now() - l2Start;
    correctedText = buildCorrectedText(segments, layer2Outputs);

  } else if (condition === 'B3' || condition === 'A2') {
    // B3/A2: Layer 1 + Layer 2 flat mode
    const l1Start = Date.now();
    layer1Results = await executeLayer1(segments, domainId);
    layer1TimeMs = Date.now() - l1Start;

    const l2Start = Date.now();
    layer2Outputs = await executeLayer2(segments, layer1Results, { domainId, mode: 'flat' });
    layer2TimeMs = Date.now() - l2Start;
    correctedText = buildCorrectedText(segments, layer2Outputs);

  } else if (condition === 'proposed' || condition === 'A3' || condition === 'A4') {
    // proposed/A3/A4: Layer 1 + Layer 2 full mode
    const l1Start = Date.now();
    layer1Results = await executeLayer1(segments, domainId);
    layer1TimeMs = Date.now() - l1Start;

    const l2Start = Date.now();
    layer2Outputs = await executeLayer2(segments, layer1Results, { domainId, mode: 'full' });
    layer2TimeMs = Date.now() - l2Start;
    correctedText = buildCorrectedText(segments, layer2Outputs);

  } else if (condition === 'A1') {
    // A1: Layer 1のみ（LLMなし）
    const l1Start = Date.now();
    const result = await executeA1(segments, domainId);
    layer1TimeMs = Date.now() - l1Start;
    layer2Outputs = result.segments;
    correctedText = result.correctedText;

  } else if (condition === 'A5') {
    // A5: スナップショット固定 (Layer 1 + Layer 2 full, snapshot data)
    const week = snapshotWeek ?? 1;

    const l1Start = Date.now();
    // A5はスナップショットベースなのでlayer1/layer2を内部で一体実行
    // 時間計測のため内部タイマーは分けずに合計をlayer2TimeMsに記録
    layer2Outputs = await executeA5(segments, domainId, week);
    layer2TimeMs = Date.now() - l1Start; // A5は内部でL1+L2を連続実行
    correctedText = buildCorrectedText(segments, layer2Outputs);
  }

  const totalTimeMs = Date.now() - totalStart;
  const totalCorrections = layer2Outputs.reduce((sum, o) => sum + o.corrections.length, 0);

  // CorrectionResultに保存（upsert）
  await prisma.correctionResult.upsert({
    where: {
      recordingId_domainId_condition: { recordingId, domainId, condition },
    },
    update: {
      layer1Result: layer1Results.length > 0 ? JSON.stringify(layer1Results) : undefined,
      layer2Result: JSON.stringify(layer2Outputs),
      correctedText,
    },
    create: {
      recordingId,
      domainId,
      condition,
      layer1Result: layer1Results.length > 0 ? JSON.stringify(layer1Results) : null,
      layer2Result: JSON.stringify(layer2Outputs),
      correctedText,
    },
  });

  return {
    recordingId,
    domainId,
    condition,
    correctedText,
    segments: layer2Outputs.map((o) => ({
      segmentIndex: o.segmentIndex,
      originalText: o.originalText,
      correctedText: o.correctedText,
      corrections: o.corrections.map((c) => ({
        originalText: c.originalText,
        correctedTo: c.correctedTo,
        entityId: c.entityId,
        prefLabel: c.prefLabel,
        confidence: c.confidence,
        reasoning: c.reasoning,
      })),
    })),
    stats: {
      totalSegments: segments.length,
      segmentsProcessed: layer2Outputs.length,
      totalCorrections,
      layer1TimeMs,
      layer2TimeMs,
      totalTimeMs,
    },
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authenticateBearer(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const recording = await prisma.recording.findUnique({ where: { id: params.id } });
    if (!recording || recording.userId !== user.id) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    if (!recording.transcriptionSegments) {
      return NextResponse.json(
        { error: 'Transcription not completed. Run transcription first.' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { domainId, condition, snapshotWeek } = body;

    if (!domainId) {
      return NextResponse.json({ error: 'domainId is required' }, { status: 400 });
    }

    if (!condition || !VALID_CONDITIONS.includes(condition as ExperimentCondition)) {
      return NextResponse.json(
        {
          error: `condition must be one of: ${VALID_CONDITIONS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (condition === 'A5' && snapshotWeek == null) {
      return NextResponse.json(
        { error: 'snapshotWeek is required for condition A5' },
        { status: 400 }
      );
    }

    const domain = await prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
    }

    let segments: Array<{ text: string; start: number; end: number }>;
    try {
      segments = JSON.parse(recording.transcriptionSegments);
    } catch {
      return NextResponse.json({ error: 'Invalid transcriptionSegments format' }, { status: 400 });
    }

    if (!segments || segments.length === 0) {
      return NextResponse.json(
        { error: 'Transcription segments are empty. Run transcription first.' },
        { status: 400 }
      );
    }

    const result = await runExperiment(
      params.id,
      domainId,
      condition as ExperimentCondition,
      segments,
      snapshotWeek ?? undefined
    );

    return NextResponse.json(result);
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Experiment API Error]', err?.message, err?.stack);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
