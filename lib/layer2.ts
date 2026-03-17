import OpenAI from 'openai';
import { Layer1Result, CorrectionCandidate } from './layer1';
import { EntityContext, getEntityContextFull, getEntityContextFlat } from './ontologyContext';

export interface Layer2Correction {
  originalText: string;
  correctedTo: string;
  entityId: string;
  prefLabel: string;
  confidence: number;
  reasoning: string;
}

export interface Layer2Output {
  segmentIndex: number;
  originalText: string;
  correctedText: string;
  corrections: Layer2Correction[];
  apiTimeMs: number;
}

export interface Layer2Options {
  domainId: string;
  mode: 'full' | 'flat';
  model?: string;
  contextWindow?: number;
}

// ---------- プロンプト生成 ----------

function formatCandidates(candidates: CorrectionCandidate[]): string {
  return candidates
    .map(
      (c) =>
        `- 「${c.originalText}」→「${c.prefLabel}」(類似度: ${c.similarity.toFixed(3)}, 読み: ${c.phoneticHint})`
    )
    .join('\n');
}

function formatContextFull(entityContexts: EntityContext[]): string {
  return entityContexts
    .map((e) => {
      const altStr = e.altLabels.length > 0 ? `別名: ${e.altLabels.join(', ')}` : '';
      const defStr = e.definition ? `定義: ${e.definition}` : '';
      const relStr =
        e.relations.length > 0
          ? `関係:\n` +
            e.relations
              .map((r) => `      → ${r.type} → ${r.targetLabel} (weight: ${r.weight})`)
              .join('\n')
          : '';
      return [
        `  - ${e.prefLabel}:`,
        altStr ? `    ${altStr}` : null,
        defStr ? `    ${defStr}` : null,
        relStr ? `    ${relStr}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

function formatContextFlat(entityContexts: EntityContext[]): string {
  return entityContexts
    .map((e) => {
      const altStr = e.altLabels.length > 0 ? ` (別名: ${e.altLabels.join(', ')})` : '';
      return `  - ${e.prefLabel}${altStr}`;
    })
    .join('\n');
}

export function buildLayer2Prompt(input: {
  originalText: string;
  candidates: CorrectionCandidate[];
  contextBefore: string[];
  contextAfter: string[];
  entityContexts: EntityContext[];
}): string {
  const beforeStr =
    input.contextBefore.length > 0 ? input.contextBefore.join('\n') : '（なし）';
  const afterStr =
    input.contextAfter.length > 0 ? input.contextAfter.join('\n') : '（なし）';
  const candidatesStr = formatCandidates(input.candidates);
  const domainKnowledge = formatContextFull(input.entityContexts);

  return `あなたはASR（音声認識）出力の訂正アシスタントです。
以下の会議音声の文字起こしセグメントに、ドメイン用語の認識誤りがある可能性があります。
候補リストとドメイン知識を参照して、最適な訂正を行ってください。

【対象セグメント】
${input.originalText}

【前後文脈】
前:
${beforeStr}
後:
${afterStr}

【訂正候補】（音韻類似度スコア付き）
${candidatesStr}

【ドメイン知識】
${domainKnowledge}

【指示】
1. 候補リストの中から、前後文脈とドメイン知識に基づいて最適な訂正を選択してください
2. 訂正が不要（ASR出力が正しい）と判断した場合は、correctionsを空配列にしてcorrectedTextはoriginalTextをそのまま返してください
3. 各訂正について確信度（0.0〜1.0）と簡潔な理由を付けてください
4. 結果は以下のJSON形式で返してください:

{
  "correctedText": "訂正後のセグメント全文",
  "corrections": [
    {
      "original": "ASR出力の該当部分",
      "corrected": "訂正後",
      "entityId": "エンティティID",
      "confidence": 0.95,
      "reasoning": "理由"
    }
  ]
}`;
}

export function buildLayer2PromptFlat(input: {
  originalText: string;
  candidates: CorrectionCandidate[];
  contextBefore: string[];
  contextAfter: string[];
  entityContexts: EntityContext[];
}): string {
  const beforeStr =
    input.contextBefore.length > 0 ? input.contextBefore.join('\n') : '（なし）';
  const afterStr =
    input.contextAfter.length > 0 ? input.contextAfter.join('\n') : '（なし）';
  const candidatesStr = formatCandidates(input.candidates);
  const termList = formatContextFlat(input.entityContexts);

  return `あなたはASR（音声認識）出力の訂正アシスタントです。
以下の会議音声の文字起こしセグメントに、ドメイン用語の認識誤りがある可能性があります。
候補リストを参照して、最適な訂正を行ってください。

【対象セグメント】
${input.originalText}

【前後文脈】
前:
${beforeStr}
後:
${afterStr}

【訂正候補】（音韻類似度スコア付き）
${candidatesStr}

【用語リスト】
${termList}

【指示】
1. 候補リストの中から、前後文脈に基づいて最適な訂正を選択してください
2. 訂正が不要（ASR出力が正しい）と判断した場合は、correctionsを空配列にしてcorrectedTextはoriginalTextをそのまま返してください
3. 各訂正について確信度（0.0〜1.0）と簡潔な理由を付けてください
4. 結果は以下のJSON形式で返してください:

{
  "correctedText": "訂正後のセグメント全文",
  "corrections": [
    {
      "original": "ASR出力の該当部分",
      "corrected": "訂正後",
      "entityId": "エンティティID",
      "confidence": 0.95,
      "reasoning": "理由"
    }
  ]
}`;
}

// ---------- JSONパース ----------

function extractJson(text: string): string {
  // JSON部分を最長一致で抽出
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

interface LLMResponse {
  correctedText: string;
  corrections: Array<{
    original: string;
    corrected: string;
    entityId: string;
    confidence: number;
    reasoning: string;
  }>;
}

// ---------- Layer 2 実行エンジン ----------

export async function executeLayer2(
  segments: Array<{ text: string; start: number; end: number }>,
  layer1Results: Layer1Result[],
  options: Layer2Options
): Promise<Layer2Output[]> {
  const { mode, model = 'gpt-4o', contextWindow = 3 } = options;

  const client = new OpenAI();
  const outputs: Layer2Output[] = [];

  for (const l1 of layer1Results) {
    if (l1.candidates.length === 0) continue;

    const idx = l1.segmentIndex;

    // 前後文脈
    const contextBefore = segments
      .slice(Math.max(0, idx - contextWindow), idx)
      .map((s) => s.text);
    const contextAfter = segments
      .slice(idx + 1, Math.min(segments.length, idx + 1 + contextWindow))
      .map((s) => s.text);

    // 候補エンティティのIDを重複排除
    const entityIds = Array.from(new Set(l1.candidates.map((c) => c.entityId)));

    // オントロジーコンテキスト取得
    const entityContexts =
      mode === 'full'
        ? await getEntityContextFull(entityIds)
        : await getEntityContextFlat(entityIds);

    // プロンプト生成
    const prompt =
      mode === 'full'
        ? buildLayer2Prompt({
            originalText: l1.originalText,
            candidates: l1.candidates,
            contextBefore,
            contextAfter,
            entityContexts,
          })
        : buildLayer2PromptFlat({
            originalText: l1.originalText,
            candidates: l1.candidates,
            contextBefore,
            contextAfter,
            entityContexts,
          });

    // OpenAI API 呼び出し
    const apiStart = Date.now();
    let llmResponse: LLMResponse;
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });
      const content = response.choices[0]?.message?.content ?? '{}';
      const jsonStr = extractJson(content);
      llmResponse = JSON.parse(jsonStr) as LLMResponse;
    } catch (err) {
      console.error(`[Layer2] API error at segment ${idx}:`, err);
      // エラー時はそのまま
      llmResponse = { correctedText: l1.originalText, corrections: [] };
    }
    const apiTimeMs = Date.now() - apiStart;

    // LLMの訂正リストを内部形式に変換
    const entityContextMap = new Map(entityContexts.map((e) => [e.entityId, e]));
    const candidateEntityMap = new Map(l1.candidates.map((c) => [c.entityId, c]));

    const corrections: Layer2Correction[] = (llmResponse.corrections ?? []).map((c) => {
      // entityIdでエンティティを特定。LLMが誤ったIDを返す場合はprefLabelで候補から検索
      let entityId = c.entityId;
      let prefLabel = entityContextMap.get(entityId)?.prefLabel ?? c.corrected;

      if (!entityContextMap.has(entityId)) {
        // prefLabelで候補を検索
        const matched = l1.candidates.find(
          (cand) => cand.prefLabel === c.corrected || cand.prefLabel === c.corrected.trim()
        );
        if (matched) {
          entityId = matched.entityId;
          prefLabel = matched.prefLabel;
        }
      }

      return {
        originalText: c.original,
        correctedTo: c.corrected,
        entityId,
        prefLabel,
        confidence: typeof c.confidence === 'number' ? c.confidence : 0,
        reasoning: c.reasoning ?? '',
      };
    });

    outputs.push({
      segmentIndex: idx,
      originalText: l1.originalText,
      correctedText: llmResponse.correctedText ?? l1.originalText,
      corrections,
      apiTimeMs,
    });
  }

  return outputs;
}

// ---------- 訂正済みテキスト生成（REQ-5）----------

export function buildCorrectedText(
  segments: Array<{ text: string; start: number; end: number }>,
  layer2Outputs: Layer2Output[]
): string {
  const outputMap = new Map(layer2Outputs.map((o) => [o.segmentIndex, o]));
  return segments
    .map((seg, idx) => {
      const output = outputMap.get(idx);
      return output ? output.correctedText : seg.text;
    })
    .join('\n');
}
