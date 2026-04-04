import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { splitAudioForWhisper, cleanupChunks, getAudioMetadata } from '@/lib/audio-utils';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Segment {
  start: number;
  end: number;
  text: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await authenticateBasicAuth(req);
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

  await prisma.recording.update({
    where: { id: params.id },
    data: { transcriptionStatus: 'processing' },
  });

  try {
    const absolutePath = path.join(process.cwd(), recording.filePath);
    const metadata = await getAudioMetadata(absolutePath);
    const chunks = await splitAudioForWhisper(absolutePath, metadata.duration);

    const allSegments: Segment[] = [];
    const allTexts: string[] = [];
    let timeOffset = 0;
    let detectedLanguage = 'ja';

    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = chunks[i];
      const fileStream = fs.createReadStream(chunkPath);

      // 前チャンクの末尾テキストをpromptに渡してコンテキスト維持
      const promptText = i > 0 && allTexts.length > 0
        ? allTexts[allTexts.length - 1].slice(-200)
        : undefined;

      const response = await openai.audio.transcriptions.create({
        file: fileStream,
        model: 'gpt-4o-transcribe',
        response_format: 'json',
        language: 'ja',
        ...(promptText ? { prompt: promptText } : {}),
      });

      allTexts.push(response.text);
      // gpt-4o-transcribe does not return segments in json format
      allSegments.push({
        start: timeOffset,
        end: timeOffset, // will be updated with chunk duration below
        text: response.text,
      });

      // 次チャンクのオフセットを計算 + 現セグメントのend更新
      if (chunks[i] !== absolutePath) {
        const chunkMeta = await getAudioMetadata(chunkPath);
        allSegments[allSegments.length - 1].end = timeOffset + chunkMeta.duration;
        timeOffset += chunkMeta.duration;
      } else {
        allSegments[allSegments.length - 1].end = metadata.duration;
      }
    }

    await cleanupChunks(chunks, absolutePath);

    const fullText = allTexts.join('');

    await prisma.recording.update({
      where: { id: params.id },
      data: {
        transcriptionStatus: 'completed',
        transcriptionText: fullText,
        transcriptionSegments: JSON.stringify(allSegments),
        language: detectedLanguage,
        transcriptionAt: new Date(),
        transcriptionError: null,
        // durationも正確な値に更新
        duration: metadata.duration,
      },
    });

    return NextResponse.json({
      success: true,
      chunks: chunks.length,
      transcription: {
        text: fullText,
        segments: allSegments,
        language: detectedLanguage,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await prisma.recording.update({
      where: { id: params.id },
      data: {
        transcriptionStatus: 'error',
        transcriptionError: message,
      },
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
