import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * 録音のセグメント一覧（whisper-1 由来、絶対時刻付き）。
 * - user: 自分の録音のみ（403）
 * - admin: 全件閲覧可
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const recording = await prisma.recording.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true, whisperTranscribedAt: true, whisperError: true },
  });
  if (!recording) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }
  if (session.role !== 'admin' && recording.userId !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const segments = await prisma.segment.findMany({
    where: { recordingId: params.id },
    orderBy: { seq: 'asc' },
    select: {
      seq: true,
      startOffset: true,
      endOffset: true,
      startAt: true,
      endAt: true,
      text: true,
    },
  });

  return NextResponse.json({
    whisperTranscribedAt: recording.whisperTranscribedAt,
    whisperError: recording.whisperError,
    segments,
  });
}
