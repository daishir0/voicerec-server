import { NextResponse } from 'next/server';
import { getUserSession } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUserSession();
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
  if (recording.userId !== session.userId) {
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
