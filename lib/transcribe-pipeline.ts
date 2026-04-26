/**
 * 文字起こしパイプライン（モード切替対応）。
 *
 * - whisper-only: whisper-1 でセグメント取得 → Segment テーブル書き込み +
 *                 Recording.transcriptionText/Segments を whisper 由来で派生（既存消費者と完全互換）
 * - dual: gpt-4o-transcribe で transcriptionText/Segments、続けて whisper-1 で Segment テーブル
 * - gpt4o-only: gpt-4o-transcribe のみ。Segment テーブルは書かない
 *
 * 4つの transcribe/upload エンドポイントから呼び出される。
 */

import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { prisma } from '@/lib/db';
import {
  splitAudioForWhisper,
  cleanupChunks,
  getAudioMetadata,
} from '@/lib/audio-utils';
import {
  transcribeWithWhisper,
  ResolvedSegment,
} from '@/lib/whisper-transcribe';
import {
  getTranscriptionMode,
  TranscriptionMode,
} from '@/lib/transcription-config';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface PseudoSegment {
  start: number;
  end: number;
  text: string;
}

export interface RunTranscriptionResult {
  mode: TranscriptionMode;
  chunks: number;
  text: string;
  segments: PseudoSegment[];
  language: string;
  whisperSegmentCount: number;
  whisperError: string | null;
}

/**
 * whisper の response.language ('japanese' など) を ISO 639-1 ('ja') に正規化。
 * フォールバックとしてユーザー指定言語を返す。
 */
function normaliseLanguage(detected: string | null, fallback: string): string {
  if (!detected) return fallback;
  const lower = detected.trim().toLowerCase();
  // 既に ISO 形式
  if (/^[a-z]{2}(-[a-z0-9]+)?$/i.test(lower)) return lower;
  const map: Record<string, string> = {
    japanese: 'ja',
    english: 'en',
    chinese: 'zh',
    mandarin: 'zh',
    korean: 'ko',
    spanish: 'es',
    french: 'fr',
    german: 'de',
    italian: 'it',
    portuguese: 'pt',
    russian: 'ru',
  };
  return map[lower] ?? fallback;
}

/**
 * メイン: モードを解決してパイプラインを実行する。
 * 例外は投げない（Recording.transcriptionStatus='error' を確実に書くため）。
 */
export async function runTranscription(
  recordingId: string,
  modeOverride?: TranscriptionMode
): Promise<RunTranscriptionResult> {
  const mode = modeOverride ?? (await getTranscriptionMode());

  await prisma.recording.update({
    where: { id: recordingId },
    data: { transcriptionStatus: 'processing' },
  });

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

  const language = recording.user.transcriptionLanguage || 'ja';
  const baseTime = recording.recordedAt ?? recording.createdAt;

  try {
    if (mode === 'whisper-only') {
      return await runWhisperOnly(recordingId, recording.userId, absolutePath, language, baseTime);
    } else if (mode === 'dual') {
      return await runDual(recordingId, recording.userId, absolutePath, language, baseTime);
    } else {
      return await runGpt4oOnly(recordingId, absolutePath, language);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        transcriptionStatus: 'error',
        transcriptionError: message,
      },
    });
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// whisper-only
// ──────────────────────────────────────────────────────────────────────────

async function runWhisperOnly(
  recordingId: string,
  userId: string,
  absolutePath: string,
  language: string,
  baseTime: Date
): Promise<RunTranscriptionResult> {
  const { segments, detectedLanguage, audioDuration } = await transcribeWithWhisper(
    absolutePath,
    language,
    baseTime
  );

  const finalLanguage = normaliseLanguage(detectedLanguage, language);
  const fullText = segments.map((s) => s.text).join('');
  const pseudoSegments: PseudoSegment[] = segments.map((s) => ({
    start: s.startOffset,
    end: s.endOffset,
    text: s.text,
  }));
  const now = new Date();

  // Segment テーブルと Recording を一括更新（再実行安全）
  await prisma.$transaction([
    prisma.segment.deleteMany({ where: { recordingId } }),
    prisma.segment.createMany({
      data: segments.map((s) => ({
        recordingId,
        userId,
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
        transcriptionStatus: 'completed',
        transcriptionText: fullText,
        transcriptionSegments: JSON.stringify(pseudoSegments),
        language: finalLanguage,
        transcriptionAt: now,
        transcriptionError: null,
        whisperTranscribedAt: now,
        whisperError: null,
        duration: audioDuration,
      },
    }),
  ]);

  return {
    mode: 'whisper-only',
    chunks: 1, // whisper helper handles chunking internally; expose count from segments grouping is not meaningful here
    text: fullText,
    segments: pseudoSegments,
    language: finalLanguage,
    whisperSegmentCount: segments.length,
    whisperError: null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// dual (gpt-4o-transcribe + whisper-1)
// ──────────────────────────────────────────────────────────────────────────

async function runDual(
  recordingId: string,
  userId: string,
  absolutePath: string,
  language: string,
  baseTime: Date
): Promise<RunTranscriptionResult> {
  // Pass 1: gpt-4o-transcribe
  const metadata = await getAudioMetadata(absolutePath);
  const chunks = await splitAudioForWhisper(absolutePath, metadata.duration);

  const allSegments: PseudoSegment[] = [];
  const allTexts: string[] = [];
  let timeOffset = 0;

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = chunks[i];
      const fileStream = fs.createReadStream(chunkPath);

      // 前チャンクの末尾テキストを prompt に渡してコンテキスト維持
      const promptText = i > 0 && allTexts.length > 0
        ? allTexts[allTexts.length - 1].slice(-200)
        : undefined;

      const response = await openai.audio.transcriptions.create({
        file: fileStream,
        model: 'gpt-4o-transcribe',
        response_format: 'json',
        language,
        ...(promptText ? { prompt: promptText } : {}),
      });

      allTexts.push(response.text);

      // gpt-4o-transcribe は json では segments を返さないためチャンク単位の擬似セグメント
      let chunkDuration = 0;
      if (chunkPath !== absolutePath) {
        const chunkMeta = await getAudioMetadata(chunkPath);
        chunkDuration = chunkMeta.duration;
      } else {
        chunkDuration = metadata.duration - timeOffset;
      }
      allSegments.push({
        start: timeOffset,
        end: timeOffset + chunkDuration,
        text: response.text,
      });
      timeOffset += chunkDuration;
    }
  } finally {
    await cleanupChunks(chunks, absolutePath).catch(() => {});
  }

  const fullText = allTexts.join('');

  await prisma.recording.update({
    where: { id: recordingId },
    data: {
      transcriptionStatus: 'completed',
      transcriptionText: fullText,
      transcriptionSegments: JSON.stringify(allSegments),
      language,
      transcriptionAt: new Date(),
      transcriptionError: null,
      duration: metadata.duration,
    },
  });

  // Pass 2: whisper-1（独立 try で囲む。失敗しても gpt-4o の結果は保持）
  let whisperSegmentCount = 0;
  let whisperErrorMessage: string | null = null;
  try {
    const { segments } = await transcribeWithWhisper(absolutePath, language, baseTime);
    await prisma.$transaction([
      prisma.segment.deleteMany({ where: { recordingId } }),
      prisma.segment.createMany({
        data: segments.map((s) => ({
          recordingId,
          userId,
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
    whisperSegmentCount = segments.length;
  } catch (whisperErr) {
    whisperErrorMessage = whisperErr instanceof Error ? whisperErr.message : 'Unknown whisper error';
    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        whisperError: whisperErrorMessage,
        whisperTranscribedAt: null,
      },
    }).catch(() => {});
  }

  return {
    mode: 'dual',
    chunks: chunks.length,
    text: fullText,
    segments: allSegments,
    language,
    whisperSegmentCount,
    whisperError: whisperErrorMessage,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// gpt4o-only
// ──────────────────────────────────────────────────────────────────────────

async function runGpt4oOnly(
  recordingId: string,
  absolutePath: string,
  language: string
): Promise<RunTranscriptionResult> {
  const metadata = await getAudioMetadata(absolutePath);
  const chunks = await splitAudioForWhisper(absolutePath, metadata.duration);

  const allSegments: PseudoSegment[] = [];
  const allTexts: string[] = [];
  let timeOffset = 0;

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = chunks[i];
      const fileStream = fs.createReadStream(chunkPath);

      const promptText = i > 0 && allTexts.length > 0
        ? allTexts[allTexts.length - 1].slice(-200)
        : undefined;

      const response = await openai.audio.transcriptions.create({
        file: fileStream,
        model: 'gpt-4o-transcribe',
        response_format: 'json',
        language,
        ...(promptText ? { prompt: promptText } : {}),
      });

      allTexts.push(response.text);

      let chunkDuration = 0;
      if (chunkPath !== absolutePath) {
        const chunkMeta = await getAudioMetadata(chunkPath);
        chunkDuration = chunkMeta.duration;
      } else {
        chunkDuration = metadata.duration - timeOffset;
      }
      allSegments.push({
        start: timeOffset,
        end: timeOffset + chunkDuration,
        text: response.text,
      });
      timeOffset += chunkDuration;
    }
  } finally {
    await cleanupChunks(chunks, absolutePath).catch(() => {});
  }

  const fullText = allTexts.join('');

  await prisma.recording.update({
    where: { id: recordingId },
    data: {
      transcriptionStatus: 'completed',
      transcriptionText: fullText,
      transcriptionSegments: JSON.stringify(allSegments),
      language,
      transcriptionAt: new Date(),
      transcriptionError: null,
      duration: metadata.duration,
    },
  });

  return {
    mode: 'gpt4o-only',
    chunks: chunks.length,
    text: fullText,
    segments: allSegments,
    language,
    whisperSegmentCount: 0,
    whisperError: null,
  };
}
