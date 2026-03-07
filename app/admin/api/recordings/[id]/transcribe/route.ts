import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const recording = await prisma.recording.findUnique({ where: { id: params.id } });
  if (!recording) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }

  await prisma.recording.update({
    where: { id: params.id },
    data: { transcriptionStatus: 'processing' },
  });

  try {
    const absolutePath = path.join(process.cwd(), recording.filePath);
    const fileStream = fs.createReadStream(absolutePath);

    const response = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
      response_format: 'verbose_json',
      language: 'ja',
    });

    const segments = (response.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    }));

    await prisma.recording.update({
      where: { id: params.id },
      data: {
        transcriptionStatus: 'completed',
        transcriptionText: response.text,
        transcriptionSegments: JSON.stringify(segments),
        language: response.language ?? 'ja',
        transcriptionAt: new Date(),
        transcriptionError: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await prisma.recording.update({
      where: { id: params.id },
      data: { transcriptionStatus: 'error', transcriptionError: message },
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
