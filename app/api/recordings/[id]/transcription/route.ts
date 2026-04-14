import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

  const status = recording.transcriptionStatus;

  if (status === 'pending' || status === 'processing') {
    return NextResponse.json({ status, text: null });
  }

  if (status === 'error') {
    return NextResponse.json({
      status,
      text: null,
      error: recording.transcriptionError,
    });
  }

  const segments = recording.transcriptionSegments
    ? JSON.parse(recording.transcriptionSegments)
    : [];

  return NextResponse.json({
    status,
    text: recording.transcriptionText,
    segments,
    language: recording.language,
  });
}
