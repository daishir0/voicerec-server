import { prisma } from '@/lib/db';
import { getAudioMetadata, formatTimestamp } from '@/lib/audio-utils';
import { moveAndEncrypt } from '@/lib/file-crypto';
import fs from 'fs/promises';
import path from 'path';

/**
 * ブラウザアップロードの共通処理
 * admin/user両方から使用
 */
export async function handleBrowserUpload(file: File, userId: string, username: string) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || '.m4a';

  // 一時ファイルに保存してメタデータを取得
  const tmpPath = path.join(process.cwd(), 'data', `.tmp_${Date.now()}${ext}`);
  await fs.mkdir(path.dirname(tmpPath), { recursive: true });
  await fs.writeFile(tmpPath, buffer);

  let timestamp: string;
  let duration = 0;

  try {
    const metadata = await getAudioMetadata(tmpPath);
    duration = metadata.duration;

    // creation_timeはファイル保存時刻（録音終了時刻）なので、
    // durationを引いて録音開始時刻を算出する
    if (metadata.creationTime) {
      const startTime = new Date(metadata.creationTime.getTime() - duration * 1000);
      timestamp = formatTimestamp(startTime);
    } else {
      timestamp = formatTimestamp(new Date());
    }
  } catch {
    timestamp = formatTimestamp(new Date());
  }

  let filename = `${timestamp}${ext}`;
  const userDir = path.join(process.cwd(), 'data', username);
  await fs.mkdir(userDir, { recursive: true });

  // 同名ファイルが存在する場合は連番を付与
  let filePath = path.join(userDir, filename);
  let counter = 1;
  while (await fileExists(filePath)) {
    filePath = path.join(userDir, `${timestamp}_${counter}${ext}`);
    counter++;
  }
  filename = path.basename(filePath);

  // 一時平文ファイルを暗号化しつつ最終パスへ移動（tmpPath は内部で削除される）
  await moveAndEncrypt(tmpPath, filePath);

  const recording = await prisma.recording.create({
    data: {
      userId,
      filename,
      originalName: file.name,
      displayName: file.name.replace(/\.[^.]+$/, ''),
      filePath: `data/${username}/${filename}`,
      fileSize: buffer.length,
      duration,
      mimeType: file.type || 'audio/mp4',
    },
  });

  return recording;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
