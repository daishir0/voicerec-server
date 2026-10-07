import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from '@/lib/bearer-auth';
import { prisma } from '@/lib/db';
import { runTranscription } from '@/lib/transcribe-pipeline';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await authenticateBearer(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const recording = await prisma.recording.findUnique({
    where: { id: params.id },
  });

  if (!recording) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }

  if (recording.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await runTranscription(params.id);

    return NextResponse.json({
      success: true,
      mode: result.mode,
      chunks: result.chunks,
      transcription: {
        text: result.text,
        segments: result.segments,
        language: result.language,
      },
      whisper: {
        segmentCount: result.whisperSegmentCount,
        error: result.whisperError,
      },
    });
  } catch (err) {
    console.error('[/api/recordings/[id]/transcribe] error', err);
    return NextResponse.json({ success: false, error: 'Transcription failed' }, { status: 500 });
  }
}
