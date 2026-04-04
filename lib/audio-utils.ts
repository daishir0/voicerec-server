import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const execFileAsync = promisify(execFile);

interface AudioMetadata {
  duration: number; // seconds
  creationTime: Date | null;
  format: string;
  size: number;
}

/**
 * ffprobeで音声ファイルのメタデータを取得
 */
export async function getAudioMetadata(filePath: string): Promise<AudioMetadata> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    filePath,
  ]);

  const data = JSON.parse(stdout);
  const format = data.format || {};
  const tags = format.tags || {};

  // 録音日時の取得（複数のタグを試行）
  let creationTime: Date | null = null;
  const timeStr = tags.creation_time || tags.date || tags.ICRD || tags.TDRC || null;
  if (timeStr) {
    const parsed = new Date(timeStr);
    if (!isNaN(parsed.getTime())) {
      creationTime = parsed;
    }
  }

  return {
    duration: parseFloat(format.duration) || 0,
    creationTime,
    format: format.format_name || '',
    size: parseInt(format.size) || 0,
  };
}

/**
 * 日付からyyyymmdd-hhmmss形式の文字列を生成
 */
export function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const se = String(date.getSeconds()).padStart(2, '0');
  return `${y}${mo}${d}-${h}${mi}${se}`;
}

/**
 * 長時間音声を API 制限に収まるチャンクに分割
 * 10分ごとに分割し、mp3に変換
 * gpt-4o-transcribe: 最大1400秒、whisper-1: 最大25MB
 */
export async function splitAudioForWhisper(filePath: string, totalDuration: number): Promise<string[]> {
  const CHUNK_DURATION = 600; // 10分 = 600秒
  const MAX_DURATION = 1300; // gpt-4o-transcribe制限（1400秒）にマージン

  // サイズ25MB以下 かつ 時間1300秒以下 なら分割不要
  const stat = await fs.stat(filePath);
  if (stat.size <= 24 * 1024 * 1024 && totalDuration <= MAX_DURATION) {
    return [filePath];
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whisper-'));
  const chunks: string[] = [];
  let offset = 0;

  while (offset < totalDuration) {
    const chunkPath = path.join(tmpDir, `chunk_${chunks.length}.mp3`);
    await execFileAsync('ffmpeg', [
      '-i', filePath,
      '-ss', String(offset),
      '-t', String(CHUNK_DURATION),
      '-vn',
      '-acodec', 'libmp3lame',
      '-ab', '64k',
      '-ar', '16000',
      '-ac', '1',
      '-y',
      chunkPath,
    ]);

    // 分割後も25MB超えなら、さらに短いチャンクに再分割
    const chunkStat = await fs.stat(chunkPath);
    if (chunkStat.size > 24 * 1024 * 1024) {
      await fs.unlink(chunkPath);
      // 半分の長さで再分割
      const halfDuration = CHUNK_DURATION / 2;
      for (let subOffset = 0; subOffset < CHUNK_DURATION && (offset + subOffset) < totalDuration; subOffset += halfDuration) {
        const subPath = path.join(tmpDir, `chunk_${chunks.length}.mp3`);
        await execFileAsync('ffmpeg', [
          '-i', filePath,
          '-ss', String(offset + subOffset),
          '-t', String(halfDuration),
          '-vn',
          '-acodec', 'libmp3lame',
          '-ab', '64k',
          '-ar', '16000',
          '-ac', '1',
          '-y',
          subPath,
        ]);
        chunks.push(subPath);
      }
    } else {
      chunks.push(chunkPath);
    }

    offset += CHUNK_DURATION;
  }

  return chunks;
}

/**
 * 分割した一時ファイルをクリーンアップ
 */
export async function cleanupChunks(chunks: string[], originalPath: string) {
  for (const chunk of chunks) {
    if (chunk !== originalPath) {
      try {
        await fs.unlink(chunk);
      } catch { /* ignore */ }
    }
  }
  // tmpディレクトリも削除
  if (chunks.length > 0 && chunks[0] !== originalPath) {
    try {
      await fs.rmdir(path.dirname(chunks[0]));
    } catch { /* ignore */ }
  }
}
