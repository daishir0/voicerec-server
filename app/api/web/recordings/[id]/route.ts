import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { serveAudioWithRange } from '@/lib/serve-audio';
import fs from 'fs/promises';
import path from 'path';

/**
 * 録音単体の取得（GET, ストリーム配信）と削除（DELETE）。
 * Web 用 Cookie 認証、role で挙動分岐：
 * - GET: user は自分のもののみ（403）、admin は全件
 * - DELETE: user は論理削除（deletedByUser=true）、admin は物理削除＋ファイル削除
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = params;
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (session.role !== 'admin' && recording.userId !== session.userId) {
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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = params;
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (session.role === 'admin') {
    // admin: 物理削除（ファイル + DB レコード）
    const filePath = path.isAbsolute(recording.filePath)
      ? recording.filePath
      : path.join(process.cwd(), recording.filePath);
    try {
      await fs.unlink(filePath);
    } catch {
      // file may already be deleted
    }
    await prisma.recording.delete({ where: { id } });
  } else {
    // user: 自分のもののみ論理削除
    if (recording.userId !== session.userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await prisma.recording.update({
      where: { id },
      data: { deletedByUser: true, deletedByUserAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true });
}
