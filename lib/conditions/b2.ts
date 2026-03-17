/**
 * B2: Whisper + LLMベースNER（GiNZA代替） + GPT-4o訂正
 *
 * GiNZAが未インストールのため、GPT-4oでNER（固有表現抽出）を代替実行する。
 * NER結果を候補リストとしてLayer 2的プロンプトに注入（オントロジーコンテキストなし）。
 */
import OpenAI from 'openai';
import type { Layer2Output } from '../layer2';

interface NEREntity {
  text: string;
  type: string;
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

function buildNERPrompt(text: string): string {
  return `以下のテキストから固有表現（人名、組織名、システム名、プロジェクト名、技術用語等）を抽出してください。

テキスト:
${text}

JSON形式で返してください:
{"entities": [{"text": "固有表現", "type": "PERSON/ORG/SYSTEM/TECH/OTHER"}]}`;
}

function buildB2CorrectionPrompt(params: {
  originalText: string;
  contextBefore: string[];
  contextAfter: string[];
  nerEntities: NEREntity[];
}): string {
  const beforeStr = params.contextBefore.length > 0 ? params.contextBefore.join('\n') : '（なし）';
  const afterStr = params.contextAfter.length > 0 ? params.contextAfter.join('\n') : '（なし）';
  const candidatesStr =
    params.nerEntities.length > 0
      ? params.nerEntities.map((e) => `- 「${e.text}」（タイプ: ${e.type}）`).join('\n')
      : '（なし）';

  return `あなたはASR（音声認識）出力の訂正アシスタントです。
以下の会議音声の文字起こしセグメントに、音声認識の誤りがある可能性があります。
NERで抽出された固有表現を参考に、最適な訂正を行ってください。

【対象セグメント】
${params.originalText}

【前後文脈】
前:
${beforeStr}
後:
${afterStr}

【NER抽出済み固有表現】
${candidatesStr}

【指示】
1. NERで抽出された固有表現を参考に、音声認識の誤りを訂正してください
2. 訂正が不要と判断した場合は、correctionsを空配列にしてcorrectedTextはoriginalTextをそのまま返してください
3. 各訂正について確信度（0.0〜1.0）と簡潔な理由を付けてください

JSON形式で返してください:
{
  "correctedText": "訂正後のセグメント全文",
  "corrections": [
    {
      "original": "ASR出力の該当部分",
      "corrected": "訂正後",
      "confidence": 0.9,
      "reasoning": "理由"
    }
  ]
}`;
}

async function extractNER(client: OpenAI, text: string): Promise<NEREntity[]> {
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 500,
      messages: [{ role: 'user', content: buildNERPrompt(text) }],
    });
    const content = response.choices[0]?.message?.content ?? '{}';
    const json = JSON.parse(extractJson(content));
    return (json.entities ?? []) as NEREntity[];
  } catch {
    return [];
  }
}

export async function executeB2(
  segments: Array<{ text: string; start: number; end: number }>,
  contextWindow = 3
): Promise<Layer2Output[]> {
  const client = new OpenAI();
  const outputs: Layer2Output[] = [];

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];

    const apiStart = Date.now();

    // Step 1: NER
    const nerEntities = await extractNER(client, seg.text);

    // NERで何も取れなかった場合はセグメントをそのままスキップ（訂正なし）
    if (nerEntities.length === 0) {
      outputs.push({
        segmentIndex: idx,
        originalText: seg.text,
        correctedText: seg.text,
        corrections: [],
        apiTimeMs: Date.now() - apiStart,
      });
      continue;
    }

    // Step 2: 訂正
    const contextBefore = segments
      .slice(Math.max(0, idx - contextWindow), idx)
      .map((s) => s.text);
    const contextAfter = segments
      .slice(idx + 1, Math.min(segments.length, idx + 1 + contextWindow))
      .map((s) => s.text);

    const prompt = buildB2CorrectionPrompt({
      originalText: seg.text,
      contextBefore,
      contextAfter,
      nerEntities,
    });

    let correctedText = seg.text;
    let corrections: Layer2Output['corrections'] = [];

    try {
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });
      const content = response.choices[0]?.message?.content ?? '{}';
      const json = JSON.parse(extractJson(content));
      correctedText = json.correctedText ?? seg.text;
      corrections = (json.corrections ?? []).map(
        (c: { original?: string; corrected?: string; confidence?: number; reasoning?: string }) => ({
          originalText: c.original ?? '',
          correctedTo: c.corrected ?? '',
          entityId: '',
          prefLabel: c.corrected ?? '',
          confidence: typeof c.confidence === 'number' ? c.confidence : 0,
          reasoning: c.reasoning ?? '',
        })
      );
    } catch (err) {
      console.error(`[B2] correction error at segment ${idx}:`, err);
    }

    outputs.push({
      segmentIndex: idx,
      originalText: seg.text,
      correctedText,
      corrections,
      apiTimeMs: Date.now() - apiStart,
    });
  }

  return outputs;
}
