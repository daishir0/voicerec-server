import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';
import { executeLayer1 } from '@/lib/layer1';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authenticateBearer(req);
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
    const { domainId, threshold = 0.8 } = body;

    if (!domainId) {
      return NextResponse.json({ error: 'domainId is required' }, { status: 400 });
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

    const startTime = Date.now();
    const results = await executeLayer1(segments, domainId, threshold);
    const processingTimeMs = Date.now() - startTime;

    // CorrectionResultに保存（upsert）
    await prisma.correctionResult.upsert({
      where: {
        recordingId_domainId_condition: {
          recordingId: params.id,
          domainId,
          condition: 'proposed',
        },
      },
      update: {
        layer1Result: JSON.stringify(results),
      },
      create: {
        recordingId: params.id,
        domainId,
        condition: 'proposed',
        layer1Result: JSON.stringify(results),
      },
    });

    const segmentsWithCandidates = results.filter((r) => r.candidates.length > 0).length;
    const totalCandidates = results.reduce((sum, r) => sum + r.candidates.length, 0);

    return NextResponse.json({
      recordingId: params.id,
      domainId,
      threshold,
      results,
      stats: {
        totalSegments: results.length,
        segmentsWithCandidates,
        totalCandidates,
        processingTimeMs,
      },
    });
  } catch (error: any) {
    console.error('[Layer1 API Error]', error?.message, error?.stack);
    return NextResponse.json(
      { error: 'Internal server error', message: error?.message },
      { status: 500 }
    );
  }
}
