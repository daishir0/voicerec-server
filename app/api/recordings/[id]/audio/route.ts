import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from '@/lib/bearer-auth';
import { prisma } from '@/lib/db';
import { serveAudioWithRange } from '@/lib/serve-audio';
import path from 'path';

/**
 * GET /api/recordings/<id>/audio
 *
 * Bearer 認証で音声実体を配信する。Web 側の /api/web/recordings/<id> と同じ
 * serveAudioWithRange() を使うため、HTTP Range（206 / Content-Range /
 * Accept-Ranges / 416）と at-rest 暗号化（AES-256-GCM）に対応済み。
 * クライアントから見える Range / Content-Length は常に平文サイズ。
 *
 * スコープ: Bearer が指すユーザーの録音のみ。role は見ない（admin も横断しない）。
 * 他人の録音・論理削除済みは存在を秘匿して 404 を返す。
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBearer(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const recording = await prisma.recording.findUnique({ where: { id: params.id } });
  if (!recording || recording.userId !== user.id || recording.deletedByUser) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const absolutePath = path.isAbsolute(recording.filePath)
    ? recording.filePath
    : path.join(process.cwd(), recording.filePath);

  return serveAudioWithRange({
    absolutePath,
    mimeType: recording.mimeType || 'audio/mp4',
    filename: recording.filename,
    rangeHeader: req.headers.get('range'),
  });
}
