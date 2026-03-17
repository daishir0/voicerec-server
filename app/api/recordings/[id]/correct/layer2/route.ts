import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';
import { executeLayer1 } from '@/lib/layer1';
import { executeLayer2, buildCorrectedText } from '@/lib/layer2';
import type { Layer1Result } from '@/lib/layer1';

interface Correction {
  originalText: string;
  correctedTo: string;
  entityId: string;
  prefLabel: string;
  confidence: number;
  reasoning?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authenticateBasicAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const recording = await prisma.recording.findUnique({
      where: { id: params.id },
    });

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
    const { domainId, mode = 'full', threshold = 0.8, model = 'gpt-4o' } = body;

    if (!domainId) {
      return NextResponse.json({ error: 'domainId is required' }, { status: 400 });
    }

    if (mode !== 'full' && mode !== 'flat') {
      return NextResponse.json({ error: 'mode must be "full" or "flat"' }, { status: 400 });
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

    const condition = mode === 'full' ? 'proposed' : 'B3';

    // Layer 1: DBにキャッシュがあれば使用、なければ実行
    let layer1Results: Layer1Result[];
    const existingResult = await prisma.correctionResult.findUnique({
      where: {
        recordingId_domainId_condition: {
          recordingId: params.id,
          domainId,
          condition,
        },
      },
    });

    if (existingResult?.layer1Result) {
      layer1Results = JSON.parse(existingResult.layer1Result) as Layer1Result[];
    } else {
      layer1Results = await executeLayer1(segments, domainId, threshold);
    }

    const startTime = Date.now();

    // Layer 2実行
    const layer2Outputs = await executeLayer2(segments, layer1Results, {
      domainId,
      mode,
      model,
    });

    // 全セグメントの訂正済みテキストを生成（REQ-5）
    const correctedText = buildCorrectedText(segments, layer2Outputs);

    const processingTimeMs = Date.now() - startTime;

    // CorrectionResultに保存（upsert）
    await prisma.correctionResult.upsert({
      where: {
        recordingId_domainId_condition: {
          recordingId: params.id,
          domainId,
          condition,
        },
      },
      update: {
        layer1Result: JSON.stringify(layer1Results),
        layer2Result: JSON.stringify(layer2Outputs),
        correctedText,
      },
      create: {
        recordingId: params.id,
        domainId,
        condition,
        layer1Result: JSON.stringify(layer1Results),
        layer2Result: JSON.stringify(layer2Outputs),
        correctedText,
      },
    });

    // stats計算
    const totalApiTimeMs = layer2Outputs.reduce((sum, o) => sum + o.apiTimeMs, 0);
    const totalCorrections = layer2Outputs.reduce((sum, o) => sum + o.corrections.length, 0);

    const results = layer2Outputs.map((o) => ({
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
    }));

    return NextResponse.json({
      recordingId: params.id,
      domainId,
      mode,
      results,
      stats: {
        totalSegments: segments.length,
        segmentsProcessed: layer2Outputs.length,
        totalCorrections,
        apiCalls: layer2Outputs.length,
        totalApiTimeMs,
        processingTimeMs,
      },
    });
  } catch (error: any) {
    console.error('[Layer2 API Error]', error?.message, error?.stack);
    return NextResponse.json(
      { error: 'Internal server error', message: error?.message },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authenticateBasicAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const recording = await prisma.recording.findUnique({ where: { id: params.id } });
    if (!recording || recording.userId !== user.id) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const domainId = searchParams.get('domainId');
    const condition = searchParams.get('condition') ?? 'proposed';

    if (!domainId) {
      return NextResponse.json({ error: 'domainId is required' }, { status: 400 });
    }

    const correctionResult = await prisma.correctionResult.findUnique({
      where: {
        recordingId_domainId_condition: {
          recordingId: params.id,
          domainId,
          condition,
        },
      },
    });

    if (!correctionResult || !correctionResult.layer2Result) {
      return NextResponse.json({ error: 'Correction result not found' }, { status: 404 });
    }

    const layer2Outputs = JSON.parse(correctionResult.layer2Result);
    const results = layer2Outputs.map((o: {
      segmentIndex: number;
      originalText: string;
      correctedText: string;
      corrections: Correction[];
    }) => ({
      segmentIndex: o.segmentIndex,
      originalText: o.originalText,
      correctedText: o.correctedText,
      corrections: o.corrections?.map((c: Correction) => ({
        originalText: c.originalText,
        correctedTo: c.correctedTo,
        entityId: c.entityId,
        prefLabel: c.prefLabel,
        confidence: c.confidence,
      })) ?? [],
    }));

    return NextResponse.json({
      recordingId: params.id,
      domainId,
      condition,
      results,
    });
  } catch (error: any) {
    console.error('[Layer2 GET Error]', error?.message);
    return NextResponse.json(
      { error: 'Internal server error', message: error?.message },
      { status: 500 }
    );
  }
}
