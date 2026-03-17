import OpenAI from 'openai';

export interface ExtractedTerm {
  prefLabel: string;
  altLabels: string[];
  phoneticHints: string[];
  definition: string;
  category: string;
}

export interface ExtractedRelation {
  fromLabel: string;
  toLabel: string;
  relationType: string;
  confidence: number;
}

export interface BootstrapResult {
  terms: ExtractedTerm[];
  relations: ExtractedRelation[];
  stats: {
    inputChunks: number;
    totalTerms: number;
    totalRelations: number;
    processingTimeMs: number;
  };
}

const CHUNK_SIZE = 3000;
const CHUNK_OVERLAP = 500;

function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

function buildPrompt(
  text: string,
  domainName: string,
  domainDescription: string,
  existingTerms: string[]
): string {
  const existingTermsStr =
    existingTerms.length > 0
      ? existingTerms.join('、')
      : '（なし）';

  return `あなたはドメイン知識抽出の専門家です。
以下のテキストから、ドメイン「${domainName}」（${domainDescription}）に関連する
専門用語・固有名詞・略語を抽出してください。

【テキスト】
${text}

【既存用語】（重複しないこと）
${existingTermsStr}

【抽出ルール】
1. 一般的な日本語（「会議」「確認」「報告」等）は除外
2. ドメイン固有の用語のみ抽出（システム名、プロジェクト名、技術用語、社内略語等）
3. 各用語について以下を推定:
   - prefLabel: 正式名称
   - altLabels: 同義語・略語・表記揺れ（配列）
   - phoneticHints: 音声認識用の読み仮名（カタカナ、配列）
   - definition: 簡潔な定義（1文）
   - category: カテゴリ（"システム", "技術用語", "プロジェクト", "組織", "プロセス" 等）

4. 用語間の関係も推定:
   - broader/narrower: 上位概念/下位概念
   - isPartOf: 部分-全体
   - isUsedIn: 使用される文脈
   - relatedTo: その他の関連

JSON形式のみで返してください（コードブロックなし）:
{
  "terms": [
    {
      "prefLabel": "...",
      "altLabels": [...],
      "phoneticHints": [...],
      "definition": "...",
      "category": "..."
    }
  ],
  "relations": [
    {
      "fromLabel": "...",
      "toLabel": "...",
      "relationType": "...",
      "confidence": 0.0
    }
  ]
}`;
}

function mergeResults(
  chunks: Array<{ terms: ExtractedTerm[]; relations: ExtractedRelation[] }>,
  existingTerms: string[]
): { terms: ExtractedTerm[]; relations: ExtractedRelation[] } {
  const termMap = new Map<string, ExtractedTerm>();
  const relationSet = new Set<string>();
  const relations: ExtractedRelation[] = [];

  const existingSet = new Set(existingTerms.map((t) => t.toLowerCase()));

  for (const chunk of chunks) {
    for (const term of chunk.terms) {
      const key = term.prefLabel.toLowerCase();
      if (existingSet.has(key)) continue;
      if (!termMap.has(key)) {
        termMap.set(key, term);
      }
    }

    for (const rel of chunk.relations) {
      const key = `${rel.fromLabel}|${rel.toLabel}|${rel.relationType}`;
      if (!relationSet.has(key)) {
        relationSet.add(key);
        relations.push(rel);
      }
    }
  }

  return { terms: Array.from(termMap.values()), relations };
}

export async function extractTermsFromText(
  text: string,
  domainName: string,
  domainDescription: string,
  existingTerms: string[] = [],
  model: string = 'gpt-4o'
): Promise<BootstrapResult> {
  const startTime = Date.now();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const chunks = splitIntoChunks(text);
  const chunkResults: Array<{ terms: ExtractedTerm[]; relations: ExtractedRelation[] }> = [];

  for (const chunk of chunks) {
    const prompt = buildPrompt(chunk, domainName, domainDescription, existingTerms);

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    const content = response.choices[0]?.message?.content ?? '{}';

    try {
      const parsed = JSON.parse(content);
      chunkResults.push({
        terms: Array.isArray(parsed.terms) ? parsed.terms : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      });
    } catch {
      chunkResults.push({ terms: [], relations: [] });
    }
  }

  const merged = mergeResults(chunkResults, existingTerms);
  const processingTimeMs = Date.now() - startTime;

  return {
    terms: merged.terms,
    relations: merged.relations,
    stats: {
      inputChunks: chunks.length,
      totalTerms: merged.terms.length,
      totalRelations: merged.relations.length,
      processingTimeMs,
    },
  };
}
