import { prisma } from '@/lib/db';

/**
 * MCP ツール定義と実行ロジック。
 * すべてのツールは userId でスコープされ、他ユーザーのデータは返さない。
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_recordings',
    description:
      '指定した期間内の録音のメタデータ一覧を返す。from_iso / to_iso は省略可能で、省略時は全期間。whisper-1 で処理済みかどうか (hasWhisperData) も含まれる。',
    inputSchema: {
      type: 'object',
      properties: {
        from_iso: { type: 'string', description: 'ISO8601 形式の開始時刻 (例: 2026-04-13T00:00:00+09:00)' },
        to_iso: { type: 'string', description: 'ISO8601 形式の終了時刻' },
        limit: { type: 'integer', description: '最大件数 (デフォルト 50, 最大 200)', default: 50 },
      },
    },
  },
  {
    name: 'get_transcript_by_time',
    description:
      '絶対時刻の範囲内にかかる発話セグメントを、録音をまたいで時系列順に返す。「昨日の15時50分から55分の発言」のような時刻ベースのクエリに使用する。from_iso と to_iso は必須。whisper-1 未処理の録音は含まれない。',
    inputSchema: {
      type: 'object',
      properties: {
        from_iso: { type: 'string', description: 'ISO8601 形式の開始時刻 (必須)' },
        to_iso: { type: 'string', description: 'ISO8601 形式の終了時刻 (必須)' },
        limit: { type: 'integer', description: '最大セグメント数 (デフォルト 500)', default: 500 },
      },
      required: ['from_iso', 'to_iso'],
    },
  },
  {
    name: 'get_transcript_full',
    description:
      '指定した録音の全文文字起こしを返す。format=gpt4o (既定・高品質テキスト) か format=whisper (時刻付きセグメント) を選択できる。',
    inputSchema: {
      type: 'object',
      properties: {
        recording_id: { type: 'string', description: '録音のID' },
        format: { type: 'string', enum: ['gpt4o', 'whisper'], default: 'gpt4o' },
      },
      required: ['recording_id'],
    },
  },
  {
    name: 'search_transcripts',
    description:
      'キーワードで whisper セグメントを全文検索する (大文字小文字区別なし)。期間で絞り込みも可能。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '検索キーワード' },
        from_iso: { type: 'string', description: 'ISO8601 開始時刻 (省略可)' },
        to_iso: { type: 'string', description: 'ISO8601 終了時刻 (省略可)' },
        limit: { type: 'integer', description: '最大件数 (デフォルト 50)', default: 50 },
      },
      required: ['query'],
    },
  },
];

type Args = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : undefined;
}
function parseIso(v: unknown): Date | null {
  const s = asString(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function callTool(userId: string, name: string, args: Args): Promise<unknown> {
  switch (name) {
    case 'list_recordings':
      return listRecordings(userId, args);
    case 'get_transcript_by_time':
      return getTranscriptByTime(userId, args);
    case 'get_transcript_full':
      return getTranscriptFull(userId, args);
    case 'search_transcripts':
      return searchTranscripts(userId, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function listRecordings(userId: string, args: Args) {
  const from = parseIso(args.from_iso);
  const to = parseIso(args.to_iso);
  const limit = Math.min(asInt(args.limit) ?? 50, 200);

  const where: Record<string, unknown> = { userId, deletedByUser: false };
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    where.recordedAt = range;
  }

  const recs = await prisma.recording.findMany({
    where,
    orderBy: { recordedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      displayName: true,
      recordedAt: true,
      duration: true,
      whisperTranscribedAt: true,
      transcriptionText: true,
    },
  });

  return {
    count: recs.length,
    recordings: recs.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      recordedAt: r.recordedAt?.toISOString() ?? null,
      durationSec: r.duration,
      hasWhisperData: !!r.whisperTranscribedAt,
      snippet: r.transcriptionText ? r.transcriptionText.slice(0, 120) : null,
    })),
  };
}

async function getTranscriptByTime(userId: string, args: Args) {
  const from = parseIso(args.from_iso);
  const to = parseIso(args.to_iso);
  if (!from || !to) throw new Error('from_iso and to_iso are required');
  const limit = Math.min(asInt(args.limit) ?? 500, 2000);

  const segments = await prisma.segment.findMany({
    where: {
      userId,
      startAt: { lt: to },
      endAt: { gt: from },
    },
    orderBy: { startAt: 'asc' },
    take: limit,
    include: {
      recording: { select: { id: true, displayName: true, recordedAt: true } },
    },
  });

  return {
    count: segments.length,
    range: { from_iso: from.toISOString(), to_iso: to.toISOString() },
    segments: segments.map((s) => ({
      recordingId: s.recordingId,
      recordingName: s.recording.displayName,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      startOffsetSec: s.startOffset,
      endOffsetSec: s.endOffset,
      text: s.text,
    })),
  };
}

async function getTranscriptFull(userId: string, args: Args) {
  const recordingId = asString(args.recording_id);
  if (!recordingId) throw new Error('recording_id is required');
  const format = asString(args.format) ?? 'gpt4o';

  const rec = await prisma.recording.findFirst({
    where: { id: recordingId, userId },
    select: {
      id: true,
      displayName: true,
      recordedAt: true,
      duration: true,
      transcriptionText: true,
      whisperTranscribedAt: true,
    },
  });
  if (!rec) throw new Error('Recording not found');

  if (format === 'whisper') {
    const segments = await prisma.segment.findMany({
      where: { recordingId, userId },
      orderBy: { seq: 'asc' },
      select: {
        seq: true,
        startOffset: true,
        endOffset: true,
        startAt: true,
        text: true,
      },
    });
    return {
      id: rec.id,
      displayName: rec.displayName,
      recordedAt: rec.recordedAt?.toISOString() ?? null,
      durationSec: rec.duration,
      whisperTranscribedAt: rec.whisperTranscribedAt?.toISOString() ?? null,
      format: 'whisper',
      segments: segments.map((s) => ({
        seq: s.seq,
        startOffsetSec: s.startOffset,
        endOffsetSec: s.endOffset,
        startAt: s.startAt.toISOString(),
        text: s.text,
      })),
    };
  }

  return {
    id: rec.id,
    displayName: rec.displayName,
    recordedAt: rec.recordedAt?.toISOString() ?? null,
    durationSec: rec.duration,
    format: 'gpt4o',
    text: rec.transcriptionText ?? '',
  };
}

async function searchTranscripts(userId: string, args: Args) {
  const query = asString(args.query);
  if (!query) throw new Error('query is required');
  const from = parseIso(args.from_iso);
  const to = parseIso(args.to_iso);
  const limit = Math.min(asInt(args.limit) ?? 50, 500);

  const where: Record<string, unknown> = {
    userId,
    text: { contains: query, mode: 'insensitive' },
  };
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    where.startAt = range;
  }

  const segments = await prisma.segment.findMany({
    where,
    orderBy: { startAt: 'desc' },
    take: limit,
    include: {
      recording: { select: { id: true, displayName: true } },
    },
  });

  return {
    count: segments.length,
    query,
    segments: segments.map((s) => ({
      recordingId: s.recordingId,
      recordingName: s.recording.displayName,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      text: s.text,
    })),
  };
}
