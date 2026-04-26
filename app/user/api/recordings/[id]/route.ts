import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { serveAudioWithRange } from '@/lib/serve-audio';
import path from 'path';

// DELETE: 論理削除（deletedByUserフラグ）
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getUserSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording || recording.userId !== session.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await prisma.recording.update({
    where: { id },
    data: { deletedByUser: true, deletedByUserAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

// GET: ファイル配信（再生用） - 自分の録音のみ。Range リクエスト対応で seek 可能。
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getUserSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording || recording.userId !== session.userId) {
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
