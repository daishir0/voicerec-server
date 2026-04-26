import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runTranscription } from '@/lib/transcribe-pipeline';

/**
 * 録音を再文字起こしする（admin only）。
 * モバイルの /api/recordings/[id]/transcribe は Bearer 認証で別系統。
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const recording = await prisma.recording.findUnique({ where: { id: params.id } });
  if (!recording) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
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
    console.error('[/api/web/recordings/[id]/transcribe] error', err);
    return NextResponse.json({ success: false, error: 'Transcription failed' }, { status: 500 });
  }
}
