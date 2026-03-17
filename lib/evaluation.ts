import { prisma } from './db';

export interface DomainEntityAnnotation {
  text: string;
  entityId?: string;
  startPos: number;
  endPos: number;
}

export interface GTSegment {
  segmentIndex: number;
  text: string;
  domainEntities: DomainEntityAnnotation[];
}

export interface EntityCERDetail {
  expected: string;
  actual: string;
  cer: number;
}

export interface SegmentCERDetail {
  segmentIndex: number;
  cerDE: number;
  cerGEN: number;
  domainEntities: EntityCERDetail[];
}

export interface CERResult {
  cerDE: number;
  cerGEN: number;
  cerTotal: number;
  dkdpRatio: number;
  entityCount: number;
  details: SegmentCERDetail[];
}

/** レーベンシュタイン距離（DP, O(nm)） */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/** 文字レベル CER: edit_distance / max(|ref|, |hyp|) */
export function characterErrorRate(reference: string, hypothesis: string): number {
  if (reference.length === 0 && hypothesis.length === 0) return 0;
  const maxLen = Math.max(reference.length, hypothesis.length);
  return levenshtein(reference, hypothesis) / maxLen;
}

/**
 * ドメインエンティティ部分のテキストを hypothesis から fuzzy 抽出する。
 * GT側の位置 [startPos, endPos) をそのまま仮説テキストに適用し、
 * 範囲外の場合は仮説テキスト全体に対してfuzzyマッチ（最小CERの部分文字列）を返す。
 */
function extractEntityFromHypothesis(
  hypothesisText: string,
  entity: DomainEntityAnnotation
): string {
  const { startPos, endPos, text: expected } = entity;

  // 位置が有効かチェック
  if (startPos >= 0 && endPos <= hypothesisText.length && startPos < endPos) {
    return hypothesisText.slice(startPos, endPos);
  }

  // fuzzy: expected と同じ長さの窓でスライドし最小CER位置を返す
  const windowSize = expected.length;
  if (windowSize === 0) return '';
  if (hypothesisText.length < windowSize) return hypothesisText;

  let bestStart = 0;
  let bestCER = Infinity;
  for (let i = 0; i <= hypothesisText.length - windowSize; i++) {
    const window = hypothesisText.slice(i, i + windowSize);
    const cer = characterErrorRate(expected, window);
    if (cer < bestCER) {
      bestCER = cer;
      bestStart = i;
    }
  }
  return hypothesisText.slice(bestStart, bestStart + windowSize);
}

/**
 * セグメント全体のCERからドメインエンティティ部分を除いた「汎用語彙」部分のCERを計算する。
 * 実装方針: GT テキストとhypothesisテキストを文字列として並べ、エンティティ位置を除外したサブ文字列同士のCERを計算。
 * エンティティ位置が重複・境界外の場合は全体CERにフォールバック。
 */
function calculateGENPart(
  refText: string,
  hypText: string,
  entities: DomainEntityAnnotation[]
): number {
  if (entities.length === 0) {
    return characterErrorRate(refText, hypText);
  }

  // GTテキストからエンティティ部分を除外した文字列を作成
  const masks = new Array(refText.length).fill(false);
  for (const ent of entities) {
    const { startPos, endPos } = ent;
    if (startPos >= 0 && endPos <= refText.length && startPos < endPos) {
      for (let i = startPos; i < endPos; i++) {
        masks[i] = true;
      }
    }
  }

  const refGen = refText
    .split('')
    .filter((_, i) => !masks[i])
    .join('');

  // hypothesis からも対応するエンティティ部分を除外（fuzzy マッチを使用）
  const hypMasks = new Array(hypText.length).fill(false);
  for (const ent of entities) {
    const extracted = extractEntityFromHypothesis(hypText, ent);
    const startInHyp = hypText.indexOf(extracted);
    if (startInHyp >= 0 && extracted.length > 0) {
      for (let i = startInHyp; i < startInHyp + extracted.length; i++) {
        if (i < hypText.length) hypMasks[i] = true;
      }
    }
  }

  const hypGen = hypText
    .split('')
    .filter((_, i) => !hypMasks[i])
    .join('');

  if (refGen.length === 0 && hypGen.length === 0) return 0;
  return characterErrorRate(refGen, hypGen);
}

/**
 * 1録音 × 1条件の CER を計算する。
 */
export async function calculateCER(
  recordingId: string,
  domainId: string,
  condition: string,
  annotatorId?: string
): Promise<CERResult> {
  // Ground Truth 取得
  let gt;
  if (annotatorId) {
    gt = await prisma.groundTruth.findUnique({
      where: {
        recordingId_domainId_annotatorId: { recordingId, domainId, annotatorId },
      },
    });
  } else {
    // 最初のアノテーターを使用
    gt = await prisma.groundTruth.findFirst({
      where: { recordingId, domainId },
      orderBy: { annotatorId: 'asc' },
    });
  }

  if (!gt) {
    throw new Error(`Ground truth not found for recordingId=${recordingId}, domainId=${domainId}`);
  }

  const gtSegments: GTSegment[] = JSON.parse(gt.segments);

  // CorrectionResult 取得
  const correction = await prisma.correctionResult.findUnique({
    where: { recordingId_domainId_condition: { recordingId, domainId, condition } },
  });

  if (!correction || !correction.layer2Result) {
    throw new Error(
      `CorrectionResult not found for condition=${condition}. Run experiment first.`
    );
  }

  // layer2Result は Layer2Output[] 形式
  interface Layer2OutputRaw {
    segmentIndex: number;
    originalText: string;
    correctedText: string;
    corrections: Array<{
      originalText: string;
      correctedTo: string;
      entityId: string;
      prefLabel: string;
      confidence: number;
      reasoning: string;
    }>;
  }
  const layer2Results: Layer2OutputRaw[] = JSON.parse(correction.layer2Result);

  // segmentIndex -> correctedText のマップ
  const hypMap = new Map<number, string>();
  for (const l2 of layer2Results) {
    hypMap.set(l2.segmentIndex, l2.correctedText ?? l2.originalText);
  }

  const segmentDetails: SegmentCERDetail[] = [];
  let totalEntityCount = 0;
  let sumDEWeighted = 0;
  let sumGENWeighted = 0;
  let sumTotalWeighted = 0;
  let totalRefChars = 0;

  for (const gtSeg of gtSegments) {
    const refText = gtSeg.text;
    const hypText = hypMap.get(gtSeg.segmentIndex) ?? refText; // 未処理なら同一とみなす
    const entities = gtSeg.domainEntities ?? [];

    // CER-DE: エンティティごとに計算して平均
    const entityDetails: EntityCERDetail[] = [];
    for (const ent of entities) {
      const expected = ent.text;
      const actual = extractEntityFromHypothesis(hypText, ent);
      const cer = characterErrorRate(expected, actual);
      entityDetails.push({ expected, actual, cer });
      totalEntityCount++;
    }

    const cerDE =
      entityDetails.length > 0
        ? entityDetails.reduce((s, e) => s + e.cer, 0) / entityDetails.length
        : 0;

    // CER-GEN: エンティティ部分を除いた部分
    const cerGEN = calculateGENPart(refText, hypText, entities);

    // 重み付き集計（文字数ベース）
    const weight = Math.max(refText.length, 1);
    sumDEWeighted += cerDE * weight;
    sumGENWeighted += cerGEN * weight;
    sumTotalWeighted += characterErrorRate(refText, hypText) * weight;
    totalRefChars += weight;

    segmentDetails.push({
      segmentIndex: gtSeg.segmentIndex,
      cerDE,
      cerGEN,
      domainEntities: entityDetails,
    });
  }

  const cerDE = totalRefChars > 0 ? sumDEWeighted / totalRefChars : 0;
  const cerGEN = totalRefChars > 0 ? sumGENWeighted / totalRefChars : 0;
  const cerTotal = totalRefChars > 0 ? sumTotalWeighted / totalRefChars : 0;
  const dkdpRatio = cerGEN > 0 ? cerDE / cerGEN : cerDE > 0 ? Infinity : 1;

  return {
    cerDE: Math.min(1, Math.max(0, cerDE)),
    cerGEN: Math.min(1, Math.max(0, cerGEN)),
    cerTotal: Math.min(1, Math.max(0, cerTotal)),
    dkdpRatio: isFinite(dkdpRatio) ? dkdpRatio : 99.99,
    entityCount: totalEntityCount,
    details: segmentDetails,
  };
}
