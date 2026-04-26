import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/auth';
import { handleBrowserUpload } from '@/lib/browser-upload';
import { prisma } from '@/lib/db';
import { runTranscription } from '@/lib/transcribe-pipeline';

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const targetUserId = formData.get('userId') as string | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (!targetUserId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  try {
    const recording = await handleBrowserUpload(file, targetUser.id, targetUser.username);

    // 非同期で文字起こしを自動開始（システム設定 TRANSCRIPTION_MODE に従う）
    runTranscription(recording.id).catch(() => {});

    return NextResponse.json(recording, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
