/**
 * 音声ファイル配信ヘルパ：HTTP Range リクエスト対応 + at-rest 暗号化対応。
 *
 * ブラウザの音声 seek 操作（`audio.currentTime = N`）はサーバが
 * `Accept-Ranges: bytes` を返し `Range` ヘッダを処理することを前提とする。
 * これが無いとブラウザは seek 後に 0 にリセットされる。
 *
 * - Range なし → 200、ファイル全体（ストリーム）
 * - Range あり → 206 Partial Content、要求範囲のみ
 * - 範囲不正 → 416 Range Not Satisfiable
 *
 * 暗号化対応:
 *   - 暗号化済ファイル (magic VREC1) は復号ストリームで配信
 *   - 平文ファイル（移行前）はそのまま配信（後方互換）
 *   - クライアントから見える Range / Content-Length は **常に平文サイズ**
 */

import fs from 'fs';
import { stat } from 'fs/promises';
import { NextResponse } from 'next/server';
import { Readable } from 'stream';
import {
  isEncrypted,
  getPlaintextSize,
  createPlaintextRangeStream,
} from './file-crypto';

export interface ServeAudioOptions {
  absolutePath: string;
  mimeType: string;
  filename: string;
  rangeHeader: string | null;
}

interface ParsedRange {
  start: number;
  end: number;
}

function parseRange(header: string, fileSize: number): ParsedRange | null {
  // 'bytes=start-end' or 'bytes=start-' or 'bytes=-suffixLength'
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const startStr = m[1];
  const endStr = m[2];

  let start: number;
  let end: number;

  if (startStr === '' && endStr === '') return null;
  if (startStr === '') {
    // 末尾 N バイト
    const suffix = parseInt(endStr, 10);
    if (!isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === '' ? fileSize - 1 : parseInt(endStr, 10);
  }
  if (!isFinite(start) || !isFinite(end)) return null;
  if (start > end || start < 0 || end >= fileSize) return null;
  return { start, end };
}

function nodeStreamToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => {
        controller.enqueue(chunk instanceof Buffer ? new Uint8Array(chunk) : chunk as Uint8Array);
      });
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

export async function serveAudioWithRange(opts: ServeAudioOptions): Promise<Response> {
  const { absolutePath, mimeType, filename, rangeHeader } = opts;

  // 平文サイズ（暗号化判定 + サイズ計算）
  let plainSize: number;
  let encrypted: boolean;
  try {
    encrypted = await isEncrypted(absolutePath);
    if (encrypted) {
      plainSize = await getPlaintextSize(absolutePath);
    } else {
      const s = await stat(absolutePath);
      plainSize = s.size;
    }
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const baseHeaders: Record<string, string> = {
    'Content-Type': mimeType || 'audio/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Cache-Control': 'private, max-age=0, must-revalidate',
  };

  if (rangeHeader) {
    const parsed = parseRange(rangeHeader, plainSize);
    if (!parsed) {
      return new Response(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes */${plainSize}`,
        },
      });
    }
    const { start, end } = parsed;
    const length = end - start + 1;
    const stream: Readable = encrypted
      ? createPlaintextRangeStream(absolutePath, start, end)
      : fs.createReadStream(absolutePath, { start, end });
    return new Response(nodeStreamToWebStream(stream), {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${plainSize}`,
        'Content-Length': String(length),
      },
    });
  }

  // 通常の全件配信（平文サイズ全体）
  const stream: Readable = encrypted
    ? createPlaintextRangeStream(absolutePath, 0, Math.max(0, plainSize - 1))
    : fs.createReadStream(absolutePath);
  return new Response(nodeStreamToWebStream(stream), {
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Length': String(plainSize),
    },
  });
}
