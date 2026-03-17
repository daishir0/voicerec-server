import OpenAI from 'openai';
import type { Layer2Output } from '../layer2';

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

function buildB1Prompt(params: {
  originalText: string;
  contextBefore: string[];
  contextAfter: string[];
}): string {
  const beforeStr = params.contextBefore.length > 0 ? params.contextBefore.join('\n') : '（なし）';
  const afterStr = params.contextAfter.length > 0 ? params.contextAfter.join('\n') : '（なし）';

  return `あなたはASR（音声認識）出力の訂正アシスタントです。
以下は会議音声の文字起こしセグメントです。
明らかな音声認識の誤り（同音異義語の誤変換、聞き取りミス等）があれば訂正してください。
ドメイン固有の専門用語は分からないので、一般的な語彙の範囲で訂正してください。

【対象セグメント】
${params.originalText}

【前後文脈】
前:
${beforeStr}
後:
${afterStr}

JSON形式で返してください:
{
  "correctedText": "訂正後のテキスト",
  "corrections": [{"original": "...", "corrected": "...", "confidence": 0.9, "reasoning": "..."}]
}`;
}

export async function executeB1(
  segments: Array<{ text: string; start: number; end: number }>,
  contextWindow = 3
): Promise<Layer2Output[]> {
  const client = new OpenAI();
  const outputs: Layer2Output[] = [];

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    const contextBefore = segments
      .slice(Math.max(0, idx - contextWindow), idx)
      .map((s) => s.text);
    const contextAfter = segments
      .slice(idx + 1, Math.min(segments.length, idx + 1 + contextWindow))
      .map((s) => s.text);

    const prompt = buildB1Prompt({ originalText: seg.text, contextBefore, contextAfter });

    const apiStart = Date.now();
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
      console.error(`[B1] error at segment ${idx}:`, err);
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
