import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAdminSession } from '@/lib/auth';
import { serveAudioWithRange } from '@/lib/serve-audio';
import fs from 'fs/promises';
import path from 'path';

// GET: ファイル配信（再生用）。Range リクエスト対応で seek 可能。
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filePath = path.isAbsolute(recording.filePath)
    ? recording.filePath
    : path.join(process.cwd(), recording.filePath);
  return serveAudioWithRange({
    absolutePath: filePath,
    mimeType: recording.mimeType || 'audio/mp4',
    filename: recording.filename,
    rangeHeader: req.headers.get('range'),
  });
}

// DELETE: 録音削除
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), recording.filePath);
  try {
    await fs.unlink(filePath);
  } catch {
    // file may already be deleted
  }

  await prisma.recording.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
