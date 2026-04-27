/**
 * 録音ファイルの保管時暗号化（at-rest encryption）。
 *
 * 設計:
 *   - 共通鍵 AES-256-GCM、チャンク化（64 KB plaintext / chunk）
 *   - 単一鍵 STORAGE_ENCRYPTION_KEY (32 bytes hex from .bashrc → systemd → process.env)
 *   - 各ファイルにランダム 12 byte の base nonce、チャンクごとのナンスは
 *     base[0..7] || u32be(chunkIndex)
 *   - チャンクごとの auth tag (16 byte) で改ざん検知
 *
 * オンディスク形式（HEADER_SIZE = 24 byte）:
 *   [8B  magic     "VREC1\0\0\0"]
 *   [1B  version   0x01]
 *   [3B  reserved  0x00 0x00 0x00]
 *   [12B base nonce (random per file)]
 *   [chunk 0 ciphertext (max CHUNK_SIZE)] [16B tag]
 *   [chunk 1 ciphertext]                  [16B tag]
 *   ...
 *   [chunk N ciphertext (<= CHUNK_SIZE)]  [16B tag]
 *
 * Range サポート:
 *   - 平文オフセットからチャンク index を計算
 *   - 該当チャンクだけ復号 → 先頭/末尾を平文範囲にトリム → Readable で配信
 */

import crypto from 'crypto';
import fs from 'fs';
import { promises as fsp } from 'fs';
import { Readable } from 'stream';
import path from 'path';
import os from 'os';

export const MAGIC = Buffer.from('VREC1\0\0\0', 'binary'); // 8 bytes
export const VERSION = 0x01;
export const CHUNK_SIZE = 64 * 1024; // 64 KB plaintext
export const TAG_SIZE = 16;
export const NONCE_SIZE = 12;
export const HEADER_SIZE = 8 /* magic */ + 1 /* version */ + 3 /* reserved */ + NONCE_SIZE; // 24

const ALGO = 'aes-256-gcm';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.STORAGE_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'STORAGE_ENCRYPTION_KEY is not set or invalid. ' +
      'Set 64-char hex (32 bytes) in ~/.bashrc and source it from systemd. ' +
      'Generate via: openssl rand -hex 32',
    );
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

function deriveChunkNonce(baseNonce: Buffer, chunkIdx: number): Buffer {
  const nonce = Buffer.alloc(NONCE_SIZE);
  baseNonce.copy(nonce, 0, 0, 8);
  nonce.writeUInt32BE(chunkIdx, 8);
  return nonce;
}

function buildHeader(baseNonce: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header.writeUInt8(VERSION, 8);
  // reserved bytes 9..11 already zero
  baseNonce.copy(header, 12);
  return header;
}

/**
 * ファイル先頭が暗号化マジックかどうか判定。
 * - 暗号化済 → true
 * - 平文 / 短すぎ / その他 → false
 */
export async function isEncrypted(filePath: string): Promise<boolean> {
  let fd: fsp.FileHandle | null = null;
  try {
    fd = await fsp.open(filePath, 'r');
    const buf = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await fd.read(buf, 0, MAGIC.length, 0);
    return bytesRead === MAGIC.length && buf.equals(MAGIC);
  } catch {
    return false;
  } finally {
    if (fd) await fd.close();
  }
}

/**
 * バッファを暗号化してファイルに書き出す（モバイル upload で使用）。
 */
export async function writeEncrypted(destPath: string, plain: Buffer): Promise<void> {
  const key = getKey();
  const baseNonce = crypto.randomBytes(NONCE_SIZE);
  const out = fs.createWriteStream(destPath);
  out.write(buildHeader(baseNonce));

  let offset = 0;
  let chunkIdx = 0;
  while (offset < plain.length) {
    const end = Math.min(offset + CHUNK_SIZE, plain.length);
    const chunk = plain.subarray(offset, end);
    const cipher = crypto.createCipheriv(ALGO, key, deriveChunkNonce(baseNonce, chunkIdx));
    const ct = Buffer.concat([cipher.update(chunk), cipher.final()]);
    out.write(ct);
    out.write(cipher.getAuthTag());
    offset = end;
    chunkIdx++;
  }

  await new Promise<void>((resolve, reject) => {
    out.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

/**
 * 一時平文ファイルを暗号化しつつ最終パスへ移動（Web upload の rename 代替）。
 * tmpPath は呼び出し前に存在している前提。完了後 tmpPath は削除される。
 */
export async function moveAndEncrypt(tmpPath: string, destPath: string): Promise<void> {
  const key = getKey();
  const baseNonce = crypto.randomBytes(NONCE_SIZE);
  const inp = fs.createReadStream(tmpPath, { highWaterMark: CHUNK_SIZE });
  const out = fs.createWriteStream(destPath);
  out.write(buildHeader(baseNonce));

  let buf = Buffer.alloc(0);
  let chunkIdx = 0;

  const writeChunk = (chunk: Buffer) => {
    const cipher = crypto.createCipheriv(ALGO, key, deriveChunkNonce(baseNonce, chunkIdx));
    const ct = Buffer.concat([cipher.update(chunk), cipher.final()]);
    out.write(ct);
    out.write(cipher.getAuthTag());
    chunkIdx++;
  };

  for await (const data of inp) {
    buf = Buffer.concat([buf, data as Buffer]);
    while (buf.length >= CHUNK_SIZE) {
      writeChunk(buf.subarray(0, CHUNK_SIZE));
      buf = buf.subarray(CHUNK_SIZE);
    }
  }
  if (buf.length > 0) {
    writeChunk(buf);
  }

  await new Promise<void>((resolve, reject) => {
    out.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });

  await fsp.unlink(tmpPath).catch(() => {});
}

/**
 * 既に存在する平文ファイルをアトミックにその場で暗号化する（移行用）。
 * 暗号化済の場合は no-op。
 */
export async function encryptInPlace(filePath: string): Promise<void> {
  if (await isEncrypted(filePath)) return;
  // 同ディレクトリに一時暗号化ファイルを作り、最後に rename でアトミック置換
  const dir = path.dirname(filePath);
  const tmpEnc = path.join(dir, `.enc_${path.basename(filePath)}_${Date.now()}_${process.pid}`);
  try {
    const key = getKey();
    const baseNonce = crypto.randomBytes(NONCE_SIZE);
    const inp = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
    const out = fs.createWriteStream(tmpEnc);
    out.write(buildHeader(baseNonce));
    let buf = Buffer.alloc(0);
    let chunkIdx = 0;
    const writeChunk = (chunk: Buffer) => {
      const cipher = crypto.createCipheriv(ALGO, key, deriveChunkNonce(baseNonce, chunkIdx));
      const ct = Buffer.concat([cipher.update(chunk), cipher.final()]);
      out.write(ct);
      out.write(cipher.getAuthTag());
      chunkIdx++;
    };
    for await (const data of inp) {
      buf = Buffer.concat([buf, data as Buffer]);
      while (buf.length >= CHUNK_SIZE) {
        writeChunk(buf.subarray(0, CHUNK_SIZE));
        buf = buf.subarray(CHUNK_SIZE);
      }
    }
    if (buf.length > 0) writeChunk(buf);
    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    await fsp.rename(tmpEnc, filePath);
  } catch (err) {
    await fsp.unlink(tmpEnc).catch(() => {});
    throw err;
  }
}

/**
 * 暗号化ファイルの平文サイズを計算（メタデータ列読み取り、復号せず）。
 */
export async function getPlaintextSize(encPath: string): Promise<number> {
  const stat = await fsp.stat(encPath);
  if (stat.size < HEADER_SIZE) throw new Error('encrypted file too small');
  const ctTotal = stat.size - HEADER_SIZE;
  if (ctTotal === 0) return 0;
  const fullChunkCt = CHUNK_SIZE + TAG_SIZE;
  const numFull = Math.floor(ctTotal / fullChunkCt);
  const remainder = ctTotal - numFull * fullChunkCt;
  if (remainder === 0) {
    return numFull * CHUNK_SIZE;
  }
  if (remainder <= TAG_SIZE) {
    throw new Error('corrupt encrypted file: trailing remainder too small');
  }
  return numFull * CHUNK_SIZE + (remainder - TAG_SIZE);
}

/**
 * 暗号化ファイルを丸ごと復号して指定パスへ書き出し。
 */
export async function decryptToFile(encPath: string, plainPath: string): Promise<void> {
  const key = getKey();
  const fd = await fsp.open(encPath, 'r');
  try {
    const headerBuf = Buffer.alloc(HEADER_SIZE);
    await fd.read(headerBuf, 0, HEADER_SIZE, 0);
    if (!headerBuf.subarray(0, 8).equals(MAGIC)) {
      throw new Error('not an encrypted file (magic mismatch)');
    }
    const baseNonce = headerBuf.subarray(12, 24);
    const stat = await fd.stat();
    const out = fs.createWriteStream(plainPath, { mode: 0o600 });
    let pos = HEADER_SIZE;
    let chunkIdx = 0;
    const fullChunkCt = CHUNK_SIZE + TAG_SIZE;
    while (pos < stat.size) {
      const remaining = stat.size - pos;
      const ctLen = Math.min(fullChunkCt, remaining);
      const buf = Buffer.alloc(ctLen);
      await fd.read(buf, 0, ctLen, pos);
      const ct = buf.subarray(0, ctLen - TAG_SIZE);
      const tag = buf.subarray(ctLen - TAG_SIZE);
      const decipher = crypto.createDecipheriv(ALGO, key, deriveChunkNonce(baseNonce, chunkIdx));
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      out.write(pt);
      pos += ctLen;
      chunkIdx++;
    }
    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  } finally {
    await fd.close();
  }
}

/**
 * 暗号化ファイルを /tmp 上の一時平文ファイルに復号。呼出側は cleanup() を必ず呼ぶ。
 * ffmpeg / OpenAI など file path が必要な処理向け。
 */
export async function decryptToTempFile(
  encPath: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const ext = path.extname(encPath) || '.bin';
  const tmpDir = os.tmpdir();
  const base = `vrec-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const tmpPath = path.join(tmpDir, base);
  await decryptToFile(encPath, tmpPath);
  const cleanup = async () => {
    await fsp.unlink(tmpPath).catch(() => {});
  };
  return { path: tmpPath, cleanup };
}

/**
 * 暗号化ファイルから平文の指定範囲 [plainStart, plainEnd] (両端含む) を Readable として返す。
 * Range リクエスト処理向け。範囲を含むチャンクだけ復号する。
 */
export function createPlaintextRangeStream(
  encPath: string,
  plainStart: number,
  plainEnd: number,
): Readable {
  if (plainStart < 0 || plainEnd < plainStart) {
    return Readable.from(Buffer.alloc(0));
  }

  const key = getKey();
  let fd: fsp.FileHandle | null = null;

  return new Readable({
    async read() {
      try {
        if (!fd) {
          fd = await fsp.open(encPath, 'r');
          const headerBuf = Buffer.alloc(HEADER_SIZE);
          await fd.read(headerBuf, 0, HEADER_SIZE, 0);
          if (!headerBuf.subarray(0, 8).equals(MAGIC)) {
            throw new Error('not an encrypted file (magic mismatch)');
          }
          const baseNonce = headerBuf.subarray(12, 24);
          const stat = await fd.stat();
          const fullChunkCt = CHUNK_SIZE + TAG_SIZE;
          const firstChunk = Math.floor(plainStart / CHUNK_SIZE);
          const lastChunk = Math.floor(plainEnd / CHUNK_SIZE);
          const dropHead = plainStart - firstChunk * CHUNK_SIZE;

          let pos = HEADER_SIZE + firstChunk * fullChunkCt;
          let emitted = 0;
          const totalToEmit = plainEnd - plainStart + 1;

          for (let cIdx = firstChunk; cIdx <= lastChunk; cIdx++) {
            const remaining = stat.size - pos;
            if (remaining <= 0) break;
            const ctLen = Math.min(fullChunkCt, remaining);
            const buf = Buffer.alloc(ctLen);
            await fd.read(buf, 0, ctLen, pos);
            const ct = buf.subarray(0, ctLen - TAG_SIZE);
            const tag = buf.subarray(ctLen - TAG_SIZE);
            const decipher = crypto.createDecipheriv(ALGO, key, deriveChunkNonce(baseNonce, cIdx));
            decipher.setAuthTag(tag);
            const pt = Buffer.concat([decipher.update(ct), decipher.final()]);

            // 先頭チャンクは plainStart までスキップ、末尾チャンクは plainEnd で打ち切り
            const chunkPlainStart = cIdx * CHUNK_SIZE;
            const sliceFrom = cIdx === firstChunk ? dropHead : 0;
            const wantedFromHere = totalToEmit - emitted;
            const sliceTo = Math.min(pt.length, sliceFrom + wantedFromHere);
            const slice = pt.subarray(sliceFrom, sliceTo);
            if (slice.length > 0) {
              this.push(slice);
              emitted += slice.length;
            }
            pos += ctLen;
            void chunkPlainStart;
            if (emitted >= totalToEmit) break;
          }
          this.push(null);
          await fd.close();
          fd = null;
        }
      } catch (err) {
        if (fd) await fd.close().catch(() => {});
        fd = null;
        this.destroy(err as Error);
      }
    },
  });
}
