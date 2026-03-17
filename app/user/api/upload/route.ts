import { NextRequest, NextResponse } from 'next/server';
import { getUserSession } from '@/lib/auth';
import { handleBrowserUpload } from '@/lib/browser-upload';
import { prisma } from '@/lib/db';

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

    // 非同期で文字起こしを自動開始
    startTranscription(recording.id, recording.filePath).catch(() => {});

    return NextResponse.json(recording, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function startTranscription(recordingId: string, filePath: string) {
  const { getAudioMetadata, splitAudioForWhisper, cleanupChunks } = await import('@/lib/audio-utils');
  const OpenAI = (await import('openai')).default;
  const fs = await import('fs');
  const path = await import('path');

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  await prisma.recording.update({
    where: { id: recordingId },
    data: { transcriptionStatus: 'processing' },
  });

  try {
    const absolutePath = path.join(process.cwd(), filePath);
    const metadata = await getAudioMetadata(absolutePath);
    const chunks = await splitAudioForWhisper(absolutePath, metadata.duration);

    const allSegments: { start: number; end: number; text: string }[] = [];
    const allTexts: string[] = [];
    let timeOffset = 0;
    let detectedLanguage = 'ja';

    for (let i = 0; i < chunks.length; i++) {
      const fileStream = fs.createReadStream(chunks[i]);
      const promptText = i > 0 && allTexts.length > 0
        ? allTexts[allTexts.length - 1].slice(-200)
        : undefined;

      const response = await openai.audio.transcriptions.create({
        file: fileStream,
        model: 'whisper-1',
        response_format: 'verbose_json',
        language: 'ja',
        ...(promptText ? { prompt: promptText } : {}),
      });

      if (response.language) detectedLanguage = response.language;

      const segments = (response.segments ?? []).map((s) => ({
        start: s.start + timeOffset,
        end: s.end + timeOffset,
        text: s.text,
      }));

      allSegments.push(...segments);
      allTexts.push(response.text);

      if (chunks[i] !== absolutePath) {
        const chunkMeta = await getAudioMetadata(chunks[i]);
        timeOffset += chunkMeta.duration;
      }
    }

    await cleanupChunks(chunks, absolutePath);

    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        transcriptionStatus: 'completed',
        transcriptionText: allTexts.join(''),
        transcriptionSegments: JSON.stringify(allSegments),
        language: detectedLanguage,
        transcriptionAt: new Date(),
        transcriptionError: null,
        duration: metadata.duration,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        transcriptionStatus: 'error',
        transcriptionError: message,
      },
    });
  }
}
