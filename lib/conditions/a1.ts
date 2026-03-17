/**
 * A1: Layer 1のみ（LLMなし）
 *
 * Layer 1を実行し、各セグメントの最高similarity候補を自動適用してcorrectedTextを生成する。
 * LLMは呼び出さない（純粋に辞書照合のみ）。
 */
import { executeLayer1, CorrectionCandidate } from '../layer1';
import type { Layer2Output } from '../layer2';

function applyHighestSimilarityCandidate(
  originalText: string,
  candidates: CorrectionCandidate[],
  threshold: number
): { correctedText: string; corrections: Layer2Output['corrections'] } {
  if (candidates.length === 0) {
    return { correctedText: originalText, corrections: [] };
  }

  // 位置ごとに最高similarityの候補を選択
  const positionMap = new Map<string, CorrectionCandidate>();
  for (const c of candidates) {
    if (c.similarity < threshold) continue;
    const key = `${c.startPos}-${c.endPos}`;
    const existing = positionMap.get(key);
    if (!existing || c.similarity > existing.similarity) {
      positionMap.set(key, c);
    }
  }

  if (positionMap.size === 0) {
    return { correctedText: originalText, corrections: [] };
  }

  // 位置でソート（後ろから置換することでオフセットずれを防ぐ）
  const sorted = Array.from(positionMap.values()).sort((a, b) => b.startPos - a.startPos);

  let correctedText = originalText;
  const corrections: Layer2Output['corrections'] = [];

  for (const c of sorted) {
    const before = correctedText.slice(0, c.startPos);
    const after = correctedText.slice(c.endPos);
    const originalPart = correctedText.slice(c.startPos, c.endPos);

    if (originalPart !== c.prefLabel) {
      correctedText = before + c.prefLabel + after;
      corrections.push({
        originalText: c.originalText,
        correctedTo: c.prefLabel,
        entityId: c.entityId,
        prefLabel: c.prefLabel,
        confidence: c.similarity,
        reasoning: `Layer 1 音韻照合 (similarity=${c.similarity.toFixed(3)}, hint=${c.phoneticHint})`,
      });
    }
  }

  return { correctedText, corrections };
}

export async function executeA1(
  segments: Array<{ text: string; start: number; end: number }>,
  domainId: string,
  threshold = 0.8
): Promise<{ segments: Layer2Output[]; correctedText: string }> {
  const layer1Results = await executeLayer1(segments, domainId, threshold);

  const layer1Map = new Map(layer1Results.map((r) => [r.segmentIndex, r]));
  const segmentOutputs: Layer2Output[] = [];

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    const l1 = layer1Map.get(idx);

    if (!l1 || l1.candidates.length === 0) {
      segmentOutputs.push({
        segmentIndex: idx,
        originalText: seg.text,
        correctedText: seg.text,
        corrections: [],
        apiTimeMs: 0,
      });
      continue;
    }

    const { correctedText, corrections } = applyHighestSimilarityCandidate(
      seg.text,
      l1.candidates,
      threshold
    );

    segmentOutputs.push({
      segmentIndex: idx,
      originalText: seg.text,
      correctedText,
      corrections,
      apiTimeMs: 0,
    });
  }

  const correctedText = segmentOutputs.map((o) => o.correctedText).join('\n');

  return { segments: segmentOutputs, correctedText };
}
