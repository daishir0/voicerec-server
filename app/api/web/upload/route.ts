import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { handleBrowserUpload } from '@/lib/browser-upload';
import { prisma } from '@/lib/db';
import { runTranscription } from '@/lib/transcribe-pipeline';

/**
 * Web からの音声アップロード（user / admin 共用）。
 * - user: 自分のスペースに保存
 * - admin: targetUserId 指定で他ユーザーのスペースに保存可能（指定なしの場合は自分）
 *
 * モバイルの /api/recordings/upload (Bearer 認証) とは別系統。
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  // admin は targetUserId 指定で他ユーザー宛てにアップロード可能
  let ownerId = session.userId;
  let ownerUsername = session.username;
  if (session.role === 'admin') {
    const targetUserId = formData.get('userId') as string | null;
    if (targetUserId && targetUserId !== session.userId) {
      const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      ownerId = targetUser.id;
      ownerUsername = targetUser.username;
    }
  }

  try {
    const recording = await handleBrowserUpload(file, ownerId, ownerUsername);
    // 非同期で文字起こしを自動開始
    runTranscription(recording.id).catch(() => {});
    return NextResponse.json(recording, { status: 201 });
  } catch (err) {
    console.error('[/api/web/upload] error', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
