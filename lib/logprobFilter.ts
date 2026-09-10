/**
 * logprobFilter.ts — GPT-4o知識境界プローブによるOSUT候補自動検出
 *
 * 方式: 各語に「O（知っている）/ X（知らない）」を答えさせ、
 *       logprob(X) - logprob(O) >= θ の語をOSUT候補として返す。
 * 根拠: ICLR 2025 Oral (arXiv:2411.14257) 知識境界シグナルの応用。
 * θ=0.5: dev set (Week14-17) キャリブレーション結果 F1=0.757 (2026-05-19)
 */

import OpenAI from 'openai';
import kuromoji from 'kuromoji';
import path from 'path';
import { prisma } from './db';

/** キャリブレーション済み閾値 (dev set F1=0.757) */
export const LOGPROB_THETA = 0.5;

const BATCH_SIZE = 20;
const MODEL = 'gpt-4o';
const ALPHA_RE = /^[A-Za-z][A-Za-z0-9\-_]{1,}$/;

const STOP_WORDS = new Set([
  'これ', 'それ', 'あれ', 'こと', 'もの', 'ため', 'よう', 'わけ', 'ところ',
  'お疲れ', '様', 'ありがとう', 'すみません', '自分', '私', '僕', '俺',
  'みなさん', '皆さん', '方', '人', '今日', '明日', '昨日', '今週', '来週',
  '今月', '来月', '今回', '次回', '前回', '最後', '最初', '場合', '問題',
  '確認', '対応', '報告', '内容', '状況', '予定', '会議', '打合', 'チーム',
  '以上', '以下', '以外', 'その他', '関係', '担当', '部分', '感じ', '話',
  '点', '形', '方法', '手順', '手続き', '作業', '業務', '進捗', '仕事',
  '案件', 'プロジェクト', 'システム', 'ツール', '機能', 'データ', 'ファイル',
  'サーバー', 'クライアント', 'ユーザー', 'ページ', 'メール', 'リリース',
  'バッチ', 'バグ', 'エラー', 'テスト', '本番', '開発', '実装', '設計',
  '設定', '更新', '追加', '削除', '修正', '完了', '終了', '開始', '実施',
]);

export interface OsutCandidate {
  word: string;
  osutScore: number;
  logprobO: number;
  logprobX: number;
}

export interface LogprobFilterResult {
  domainId: string;
  candidates: OsutCandidate[];
  wordsTested: number;
}

// ── Kuromoji tokenizer ───────────────────────────────────────────────────────

let _tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;

async function getTokenizer(): Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> {
  if (_tokenizer) return _tokenizer;
  const dictPath = path.join(process.cwd(), 'node_modules/kuromoji/dict');
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictPath }).build((err, t) => {
      if (err) return reject(err);
      _tokenizer = t;
      resolve(t);
    });
  });
}

/** テキストから名詞・アルファベット語を抽出（重複除去済み） */
export async function extractCandidateWords(text: string): Promise<string[]> {
  const tokenizer = await getTokenizer();
  const tokens = tokenizer.tokenize(text);
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const t of tokens) {
    const surface = t.surface_form;
    if (surface.length < 2) continue;
    if (seen.has(surface)) continue;
    if (STOP_WORDS.has(surface)) continue;
    if (/^[\d\s]+$/.test(surface)) continue;

    const isAlpha = ALPHA_RE.test(surface);
    const pos: string = (t as kuromoji.IpadicFeatures).pos ?? '';
    const posDetail: string = (t as kuromoji.IpadicFeatures).pos_detail_1 ?? '';
    const isTargetNoun =
      pos === '名詞' &&
      (posDetail === '固有名詞' || posDetail === '一般' || posDetail === '普通名詞');

    if (isAlpha || isTargetNoun) {
      seen.add(surface);
      candidates.push(surface);
    }
  }

  return candidates;
}

// ── GPT-4o 知識プローブ ──────────────────────────────────────────────────────

async function probeWordsBatch(
  client: OpenAI,
  words: string[]
): Promise<OsutCandidate[]> {
  const promptLines = words.map((w) => `語: ${w} →`).join('\n');
  const userMsg =
    '以下の各語について、一般的な日本語の辞書や一般知識として知っているかどうかを' +
    'O（知っている）か X（知らない）の1文字のみで答えてください。' +
    '各行に O か X のみ。説明不要。\n\n' +
    promptLines;

  let response: Awaited<ReturnType<OpenAI['chat']['completions']['create']>>;
  try {
    response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: userMsg }],
      logprobs: true,
      top_logprobs: 3,
      max_tokens: words.length * 4,
      temperature: 0,
    });
  } catch (err) {
    console.error('[logprobFilter] API error:', err);
    return words.map((w) => ({ word: w, osutScore: 0, logprobO: -10, logprobX: -10 }));
  }

  const tokenItems = response.choices[0]?.logprobs?.content ?? [];
  const oxItems: Array<{ logprobO: number; logprobX: number }> = [];

  for (const item of tokenItems) {
    const tok = item.token.trim();
    const isO = ['O', 'o', '○', 'Ｏ'].includes(tok);
    const isX = ['X', 'x', '×', 'Ｘ'].includes(tok);
    if (!isO && !isX) continue;

    const top: Record<string, number> = {};
    for (const tp of item.top_logprobs ?? []) {
      top[tp.token.trim()] = tp.logprob;
    }

    let lpO = Math.max(top['O'] ?? -20, top['o'] ?? -20, top['○'] ?? -20, top['Ｏ'] ?? -20);
    let lpX = Math.max(top['X'] ?? -20, top['x'] ?? -20, top['×'] ?? -20, top['Ｘ'] ?? -20);
    if (isO && lpO < item.logprob - 0.1) lpO = item.logprob;
    if (isX && lpX < item.logprob - 0.1) lpX = item.logprob;

    oxItems.push({ logprobO: lpO, logprobX: lpX });
  }

  return words.map((word, i) => {
    if (i >= oxItems.length) return { word, osutScore: 0, logprobO: -10, logprobX: -10 };
    const { logprobO, logprobX } = oxItems[i];
    return {
      word,
      osutScore: Math.round((logprobX - logprobO) * 10000) / 10000,
      logprobO: Math.round(logprobO * 10000) / 10000,
      logprobX: Math.round(logprobX * 10000) / 10000,
    };
  });
}

// ── メインエントリーポイント ──────────────────────────────────────────────────

/**
 * 会議テキストからOSUT候補を検出する。
 * @param text 文字起こしテキスト
 * @param domainId ドメインID
 * @param theta OSUT判定閾値（デフォルト: LOGPROB_THETA=0.5）
 */
export async function runLogprobFilter(
  text: string,
  domainId: string,
  theta = LOGPROB_THETA
): Promise<LogprobFilterResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const words = await extractCandidateWords(text);

  const allResults: OsutCandidate[] = [];
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const batch = words.slice(i, i + BATCH_SIZE);
    const results = await probeWordsBatch(client, batch);
    allResults.push(...results);
    if (i + BATCH_SIZE < words.length) {
      await new Promise<void>((r) => setTimeout(r, 300));
    }
  }

  const candidates = allResults.filter((r) => r.osutScore >= theta);
  return { domainId, candidates, wordsTested: words.length };
}

// ── OSUT候補をFeedbackとして保存（レビュー待ち） ────────────────────────────

/**
 * OSUT候補をFeedback.suggest_termとして保存する。
 * autoApprove=trueの場合はオントロジーに直接追加（既存エンティティは除外）。
 *
 * @param candidates runLogprobFilterの結果
 * @param domainId ドメインID
 * @param recordingId 録音ID
 * @param userId ユーザーID
 * @param autoApprove trueの場合はオントロジーに直接追加
 */
export async function persistOsutCandidates(
  candidates: OsutCandidate[],
  domainId: string,
  recordingId: string,
  userId: string,
  autoApprove = false
): Promise<{ added: number; skipped: number }> {
  if (candidates.length === 0) return { added: 0, skipped: 0 };

  const existingEntities = await prisma.ontologyEntity.findMany({
    where: { domainId, isActive: true },
    select: { prefLabel: true, altLabels: true },
  });

  const knownLabels = new Set<string>();
  for (const e of existingEntities) {
    knownLabels.add(e.prefLabel.toLowerCase());
    const alts = JSON.parse(e.altLabels) as string[];
    for (const a of alts) knownLabels.add(a.toLowerCase());
  }

  let added = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    if (knownLabels.has(candidate.word.toLowerCase())) {
      skipped++;
      continue;
    }

    if (autoApprove) {
      await prisma.ontologyEntity.create({
        data: {
          domainId,
          prefLabel: candidate.word,
          altLabels: '[]',
          phoneticHints: JSON.stringify([candidate.word]),
          source: 'logprob_auto',
        },
      });
    } else {
      await prisma.feedback.create({
        data: {
          recordingId,
          domainId,
          userId,
          segmentIndex: -1,
          feedbackType: 'suggest_term',
          originalText: candidate.word,
          suggestedTerm: candidate.word,
          suggestedReading: candidate.word,
          comment: `logprob_osut_score=${candidate.osutScore.toFixed(4)}`,
        },
      });
    }
    added++;
  }

  return { added, skipped };
}
