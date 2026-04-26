import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { prisma } from '@/lib/db';
import { splitAudioForWhisper, cleanupChunks, getAudioMetadata } from '@/lib/audio-utils';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface WhisperSegmentRaw {
  start: number;
  end: number;
  text: string;
}

export interface ResolvedSegment {
  seq: number;
  startOffset: number;
  endOffset: number;
  startAt: Date;
  endAt: Date;
  text: string;
}

export interface TranscribeWithWhisperResult {
  segments: ResolvedSegment[];
  detectedLanguage: string | null;
  audioDuration: number;
}

/**
 * 純粋計算ヘルパ：whisper-1 (verbose_json) で音声をチャンク分割しつつ文字起こしし、
 * 録音開始時刻 baseTime から絶対時刻を持つ ResolvedSegment[] を返す。
 *
 * - DB アクセスは一切しない（呼び出し側で Segment テーブルへ書く）
 * - 失敗時は例外を投げる
 * - chunk の cleanup までこの関数で行う
 */
export async function transcribeWithWhisper(
  absolutePath: string,
  language: string,
  baseTime: Date
): Promise<TranscribeWithWhisperResult> {
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Audio file not found on disk: ${absolutePath}`);
  }

  const metadata = await getAudioMetadata(absolutePath);
  const chunks = await splitAudioForWhisper(absolutePath, metadata.duration);

  const resolved: ResolvedSegment[] = [];
  let timeOffset = 0;
  let seq = 0;
  let detectedLanguage: string | null = null;

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = chunks[i];
      const fileStream = fs.createReadStream(chunkPath);

      const response = await openai.audio.transcriptions.create({
        file: fileStream,
        model: 'whisper-1',
        response_format: 'verbose_json',
        language,
      });

      // verbose_json は { text, language, duration, segments: [...] }
      const respLang = (response as unknown as { language?: string }).language;
      if (respLang && !detectedLanguage) {
        detectedLanguage = respLang;
      }

      const segs: WhisperSegmentRaw[] = ((response as unknown as { segments?: WhisperSegmentRaw[] }).segments) ?? [];

      for (const s of segs) {
        const startOffset = timeOffset + s.start;
        const endOffset = timeOffset + s.end;
        resolved.push({
          seq: seq++,
          startOffset,
          endOffset,
          startAt: new Date(baseTime.getTime() + startOffset * 1000),
          endAt: new Date(baseTime.getTime() + endOffset * 1000),
          text: s.text.trim(),
        });
      }

      // 次チャンク用のオフセットを実測値で進める
      if (chunkPath !== absolutePath) {
        const chunkMeta = await getAudioMetadata(chunkPath);
        timeOffset += chunkMeta.duration;
      } else {
        timeOffset = metadata.duration;
      }
    }
  } finally {
    await cleanupChunks(chunks, absolutePath).catch(() => {});
  }

  return {
    segments: resolved,
    detectedLanguage,
    audioDuration: metadata.duration,
  };
}

/**
 * whisper-1 (verbose_json) で音声を文字起こしし、発話単位のセグメントを Segment テーブルに保存する。
 *
 * - 既存の gpt-4o-transcribe 結果には触れない
 * - 失敗時は例外を投げる（呼び出し側で whisperError に記録すること）
 * - 言語は uploader の User.transcriptionLanguage を参照
 * - 既存セグメントがあれば一度削除してから再登録する（再実行可能）
 *
 * Phase D のバックフィルからも直接呼び出せる独立モジュール。
 */
export async function runWhisperTranscription(recordingId: string): Promise<{ segmentCount: number }> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    include: { user: true },
  });

  if (!recording) {
    throw new Error(`Recording not found: ${recordingId}`);
  }

  const absolutePath = path.isAbsolute(recording.filePath)
    ? recording.filePath
    : path.join(process.cwd(), recording.filePath);

  // recordedAt が無いと絶対時刻が計算できない。フォールバックとして createdAt を使う。
  const baseTime = recording.recordedAt ?? recording.createdAt;
  const language = recording.user.transcriptionLanguage || 'ja';

  const { segments } = await transcribeWithWhisper(absolutePath, language, baseTime);

  // 既存セグメントを削除 → 新規 bulk insert（再実行可能）
  await prisma.$transaction([
    prisma.segment.deleteMany({ where: { recordingId } }),
    prisma.segment.createMany({
      data: segments.map((s) => ({
        recordingId,
        userId: recording.userId,
        seq: s.seq,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        startAt: s.startAt,
        endAt: s.endAt,
        text: s.text,
      })),
    }),
    prisma.recording.update({
      where: { id: recordingId },
      data: {
        whisperTranscribedAt: new Date(),
        whisperError: null,
      },
    }),
  ]);

  return { segmentCount: segments.length };
}
