import { NextRequest, NextResponse } from 'next/server';
import { getUserSession } from '@/lib/auth';
import { handleBrowserUpload } from '@/lib/browser-upload';
import { runTranscription } from '@/lib/transcribe-pipeline';

export async function POST(req: NextRequest) {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  try {
    const recording = await handleBrowserUpload(file, session.userId, session.username);

    // 非同期で文字起こしを自動開始（システム設定 TRANSCRIPTION_MODE に従う）
    runTranscription(recording.id).catch(() => {});

    return NextResponse.json(recording, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
