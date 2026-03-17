import { prisma } from './db';
import { normalizeKatakana, jaroWinklerSimilarity } from './phonetic';
import { generateNGrams } from './tokenizer';

export interface CorrectionCandidate {
  entityId: string;
  prefLabel: string;
  altLabels: string[];
  phoneticHint: string;
  similarity: number;
  originalText: string;
  startPos: number;
  endPos: number;
  ngramN: number;
}

export interface Layer1Result {
  segmentIndex: number;
  originalText: string;
  candidates: CorrectionCandidate[];
}

interface EntityPhonetics {
  entityId: string;
  prefLabel: string;
  altLabels: string[];
  phoneticHints: string[];
}

export async function executeLayer1(
  segments: Array<{ text: string; start: number; end: number }>,
  domainId: string,
  threshold = 0.8
): Promise<Layer1Result[]> {
  // ドメインのエンティティとphoneticHintsを取得
  const entities = await prisma.ontologyEntity.findMany({
    where: { domainId, isActive: true },
    select: {
      id: true,
      prefLabel: true,
      altLabels: true,
      phoneticHints: true,
    },
  });

  const entityPhonetics: EntityPhonetics[] = entities.map((e) => ({
    entityId: e.id,
    prefLabel: e.prefLabel,
    altLabels: JSON.parse(e.altLabels) as string[],
    phoneticHints: JSON.parse(e.phoneticHints) as string[],
  }));

  const results: Layer1Result[] = [];

  for (let segIndex = 0; segIndex < segments.length; segIndex++) {
    const seg = segments[segIndex];
    const ngrams = await generateNGrams(seg.text);

    const candidateMap = new Map<string, CorrectionCandidate>();

    for (const ngram of ngrams) {
      const ngramReading = normalizeKatakana(ngram.reading);

      for (const entity of entityPhonetics) {
        for (const hint of entity.phoneticHints) {
          const normalizedHint = normalizeKatakana(hint);
          if (!normalizedHint) continue;

          const sim = jaroWinklerSimilarity(ngramReading, normalizedHint);
          if (sim < threshold) continue;

          // 同一位置・同一エンティティで最高スコアを保持
          const key = `${ngram.startPos}-${ngram.endPos}-${entity.entityId}`;
          const existing = candidateMap.get(key);
          if (!existing || sim > existing.similarity) {
            candidateMap.set(key, {
              entityId: entity.entityId,
              prefLabel: entity.prefLabel,
              altLabels: entity.altLabels,
              phoneticHint: hint,
              similarity: sim,
              originalText: ngram.text,
              startPos: ngram.startPos,
              endPos: ngram.endPos,
              ngramN: ngram.n,
            });
          }
        }
      }
    }

    // similarity降順でソート
    const candidates = Array.from(candidateMap.values()).sort(
      (a, b) => b.similarity - a.similarity
    );

    results.push({
      segmentIndex: segIndex,
      originalText: seg.text,
      candidates,
    });
  }

  return results;
}
