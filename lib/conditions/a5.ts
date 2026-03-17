/**
 * A5: Layer 1 + Layer 2（Week N固定スナップショット使用）
 *
 * DBの現在のオントロジーは使用せず、指定されたweekNumberのスナップショットデータを
 * メモリ上の一時オントロジーとして使用してLayer 1 + Layer 2 full を実行する。
 */
import OpenAI from 'openai';
import { prisma } from '../db';
import { normalizeKatakana, jaroWinklerSimilarity } from '../phonetic';
import { generateNGrams } from '../tokenizer';
import { buildLayer2Prompt } from '../layer2';
import type { Layer1Result, CorrectionCandidate } from '../layer1';
import type { Layer2Output, Layer2Correction } from '../layer2';
import type { EntityContext } from '../ontologyContext';

// ---------- スナップショットデータ型 ----------

interface SnapshotEntity {
  prefLabel: string;
  altLabels: string[];
  phoneticHints: string[];
  definition?: string | null;
  category?: string | null;
}

interface SnapshotRelation {
  from: string;
  to: string;
  type: string;
  weight: number;
}

interface SnapshotData {
  entities: SnapshotEntity[];
  relations?: SnapshotRelation[];
}

// ---------- スナップショットベースの Layer 1 ----------

async function executeLayer1FromSnapshot(
  segments: Array<{ text: string; start: number; end: number }>,
  entities: SnapshotEntity[],
  threshold = 0.8
): Promise<Layer1Result[]> {
  // 一時IDを付与したエンティティリスト
  const entityPhonetics = entities.map((e, i) => ({
    entityId: `snap_${i}`,
    prefLabel: e.prefLabel,
    altLabels: e.altLabels,
    phoneticHints: e.phoneticHints,
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

    const candidates = Array.from(candidateMap.values()).sort(
      (a, b) => b.similarity - a.similarity
    );

    results.push({ segmentIndex: segIndex, originalText: seg.text, candidates });
  }

  return results;
}

// ---------- スナップショットベースのコンテキスト構築 ----------

function buildEntityContextFromSnapshot(
  entityIds: string[],
  entities: SnapshotEntity[],
  relations: SnapshotRelation[]
): EntityContext[] {
  // snap_N 形式のIDからインデックスを逆引き
  const entityMap = new Map<string, SnapshotEntity>();
  entities.forEach((e, i) => entityMap.set(`snap_${i}`, e));

  return entityIds.flatMap((eid) => {
    const entity = entityMap.get(eid);
    if (!entity) return [];

    const relationsFrom = relations
      .filter((r) => r.from === entity.prefLabel)
      .map((r) => ({ type: r.type, targetLabel: r.to, weight: r.weight }));

    const relationsTo = relations
      .filter((r) => r.to === entity.prefLabel)
      .map((r) => ({ type: `inverse:${r.type}`, targetLabel: r.from, weight: r.weight }));

    return [
      {
        entityId: eid,
        prefLabel: entity.prefLabel,
        altLabels: entity.altLabels,
        definition: entity.definition ?? null,
        category: entity.category ?? null,
        relations: [...relationsFrom, ...relationsTo],
      },
    ];
  });
}

// ---------- スナップショットベースの Layer 2 ----------

function extractJson(text: string): string {
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

async function executeLayer2FromSnapshot(
  segments: Array<{ text: string; start: number; end: number }>,
  layer1Results: Layer1Result[],
  entities: SnapshotEntity[],
  relations: SnapshotRelation[],
  model = 'gpt-4o',
  contextWindow = 3
): Promise<Layer2Output[]> {
  const client = new OpenAI();
  const outputs: Layer2Output[] = [];

  for (const l1 of layer1Results) {
    if (l1.candidates.length === 0) continue;

    const idx = l1.segmentIndex;
    const contextBefore = segments
      .slice(Math.max(0, idx - contextWindow), idx)
      .map((s) => s.text);
    const contextAfter = segments
      .slice(idx + 1, Math.min(segments.length, idx + 1 + contextWindow))
      .map((s) => s.text);

    const entityIds = Array.from(new Set(l1.candidates.map((c) => c.entityId)));
    const entityContexts = buildEntityContextFromSnapshot(entityIds, entities, relations);

    const prompt = buildLayer2Prompt({
      originalText: l1.originalText,
      candidates: l1.candidates,
      contextBefore,
      contextAfter,
      entityContexts,
    });

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
      llmResponse = JSON.parse(extractJson(content)) as LLMResponse;
    } catch (err) {
      console.error(`[A5] Layer2 error at segment ${idx}:`, err);
      llmResponse = { correctedText: l1.originalText, corrections: [] };
    }

    const apiTimeMs = Date.now() - apiStart;
    const entityContextMap = new Map(entityContexts.map((e) => [e.entityId, e]));

    const corrections: Layer2Correction[] = (llmResponse.corrections ?? []).map((c) => {
      let entityId = c.entityId;
      let prefLabel = entityContextMap.get(entityId)?.prefLabel ?? c.corrected;

      if (!entityContextMap.has(entityId)) {
        const matched = l1.candidates.find(
          (cand) => cand.prefLabel === c.corrected || cand.prefLabel === c.corrected?.trim()
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

// ---------- メインエントリーポイント ----------

export async function executeA5(
  segments: Array<{ text: string; start: number; end: number }>,
  domainId: string,
  snapshotWeek: number,
  threshold = 0.8,
  model = 'gpt-4o'
): Promise<Layer2Output[]> {
  // スナップショット取得
  const snapshot = await prisma.ontologySnapshot.findUnique({
    where: { domainId_weekNumber: { domainId, weekNumber: snapshotWeek } },
  });

  if (!snapshot) {
    throw new Error(`Snapshot not found: domainId=${domainId}, weekNumber=${snapshotWeek}`);
  }

  const snapshotData = JSON.parse(snapshot.data) as SnapshotData;
  const entities = snapshotData.entities ?? [];
  const relations = snapshotData.relations ?? [];

  // スナップショットデータでLayer 1実行
  const layer1Results = await executeLayer1FromSnapshot(segments, entities, threshold);

  // スナップショットデータでLayer 2実行（full mode相当）
  const layer2Outputs = await executeLayer2FromSnapshot(
    segments,
    layer1Results,
    entities,
    relations,
    model
  );

  return layer2Outputs;
}

export { executeLayer1FromSnapshot };
export type { SnapshotData, SnapshotEntity, SnapshotRelation };
