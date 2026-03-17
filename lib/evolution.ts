import OpenAI from 'openai';
import { prisma } from './db';

export interface EvolutionResult {
  newEntities: Array<{
    prefLabel: string;
    altLabels: string[];
    phoneticHints: string[];
    status: string; // "added" | "candidate"
  }>;
  newPhonetics: Array<{
    entityId: string;
    prefLabel: string;
    addedHints: string[];
  }>;
  newRelations: Array<{
    from: string;
    to: string;
    type: string;
    confidence: number;
  }>;
  stats: {
    feedbacksProcessed: number;
    entitiesAdded: number;
    phoneticsAdded: number;
    relationsInferred: number;
  };
}

export interface EvolutionOptions {
  minOccurrences?: number; // θ₂（デフォルト3）
  autoApprove?: boolean;   // true: 即時反映、false: プレビューのみ
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- 進化操作1: 新用語追加 ----------

async function evolveNewEntities(
  domainId: string,
  minOccurrences: number,
  autoApprove: boolean,
  existingLabels: Set<string>
): Promise<EvolutionResult['newEntities']> {
  // suggest_term フィードバックを集計
  const feedbacks = await prisma.feedback.findMany({
    where: {
      domainId,
      feedbackType: { in: ['suggest_term', 'reject'] },
      suggestedTerm: { not: null },
    },
    select: { suggestedTerm: true, suggestedReading: true },
  });

  // 用語ごとの出現回数を集計
  const termCount = new Map<string, { count: number; readings: string[] }>();
  for (const fb of feedbacks) {
    if (!fb.suggestedTerm) continue;
    const term = fb.suggestedTerm.trim();
    if (!term) continue;
    const entry = termCount.get(term) ?? { count: 0, readings: [] };
    entry.count++;
    if (fb.suggestedReading) entry.readings.push(fb.suggestedReading);
    termCount.set(term, entry);
  }

  // θ₂以上の用語で、既存エンティティに存在しないものを候補とする
  const candidates: Array<{ term: string; readings: string[] }> = [];
  for (const [term, { count, readings }] of Array.from(termCount.entries())) {
    if (count >= minOccurrences && !existingLabels.has(term)) {
      candidates.push({ term, readings: Array.from(new Set(readings)) });
    }
  }

  if (candidates.length === 0) return [];

  // LLMで各候補のメタデータを推定
  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  const existingTermsStr = Array.from(existingLabels).slice(0, 50).join('、');

  const prompt = `あなたはドメイン知識抽出の専門家です。
ドメイン「${domain?.name}」（${domain?.description}）に関して、
以下の新用語候補について情報を補完してください。

【既存用語（参考）】
${existingTermsStr}

【新用語候補】
${candidates.map((c) => `- ${c.term}（読み候補: ${c.readings.join(', ') || 'なし'}）`).join('\n')}

各用語について以下をJSON配列で返してください（コードブロックなし）:
[
  {
    "prefLabel": "用語名",
    "altLabels": ["同義語", "略語"],
    "phoneticHints": ["カタカナ読み"],
    "definition": "簡潔な定義",
    "category": "カテゴリ",
    "relatedExisting": ["既存用語との関係（用語名）"]
  }
]`;

  let enrichedCandidates: Array<{
    prefLabel: string;
    altLabels: string[];
    phoneticHints: string[];
    definition?: string;
    category?: string;
    relatedExisting?: string[];
  }> = [];

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    const text = res.choices[0]?.message?.content ?? '[]';
    enrichedCandidates = JSON.parse(text);
  } catch {
    // LLM失敗時は候補をそのまま使用
    enrichedCandidates = candidates.map((c) => ({
      prefLabel: c.term,
      altLabels: [],
      phoneticHints: c.readings,
    }));
  }

  const result: EvolutionResult['newEntities'] = [];

  for (const enriched of enrichedCandidates) {
    if (!enriched.prefLabel) continue;

    const status = autoApprove ? 'added' : 'candidate';

    if (autoApprove) {
      // オントロジーに追加（既存チェック）
      const existing = await prisma.ontologyEntity.findUnique({
        where: { domainId_prefLabel: { domainId, prefLabel: enriched.prefLabel } },
      });
      if (!existing) {
        const created = await prisma.ontologyEntity.create({
          data: {
            domainId,
            prefLabel: enriched.prefLabel,
            altLabels: JSON.stringify(enriched.altLabels ?? []),
            phoneticHints: JSON.stringify(enriched.phoneticHints ?? []),
            definition: enriched.definition ?? null,
            category: enriched.category ?? null,
            source: 'feedback',
          },
        });

        // 関連する既存エンティティとの関係を推定して追加
        if (enriched.relatedExisting && enriched.relatedExisting.length > 0) {
          for (const relatedLabel of enriched.relatedExisting) {
            const relatedEntity = await prisma.ontologyEntity.findUnique({
              where: { domainId_prefLabel: { domainId, prefLabel: relatedLabel } },
            });
            if (relatedEntity) {
              await prisma.ontologyRelation.upsert({
                where: {
                  fromEntityId_toEntityId_relationType: {
                    fromEntityId: created.id,
                    toEntityId: relatedEntity.id,
                    relationType: 'relatedTo',
                  },
                },
                update: { source: 'feedback' },
                create: {
                  fromEntityId: created.id,
                  toEntityId: relatedEntity.id,
                  relationType: 'relatedTo',
                  cooccurrenceWeight: 1.0,
                  source: 'feedback',
                },
              });
            }
          }
        }
      }
    }

    result.push({
      prefLabel: enriched.prefLabel,
      altLabels: enriched.altLabels ?? [],
      phoneticHints: enriched.phoneticHints ?? [],
      status,
    });
  }

  return result;
}

// ---------- 進化操作2: 読み仮名学習 ----------

async function evolvePhonetics(
  domainId: string,
  minOccurrences: number,
  autoApprove: boolean
): Promise<EvolutionResult['newPhonetics']> {
  // suggestedReading を持つフィードバックを集計（suggest_term or suggest_correction）
  const feedbacks = await prisma.feedback.findMany({
    where: {
      domainId,
      suggestedReading: { not: null },
      feedbackType: { in: ['suggest_term', 'suggest_correction', 'reject'] },
    },
    select: { suggestedTerm: true, suggestedReading: true },
  });

  // (term -> reading) の出現回数を集計
  const readingCount = new Map<string, Map<string, number>>();
  for (const fb of feedbacks) {
    if (!fb.suggestedTerm || !fb.suggestedReading) continue;
    const term = fb.suggestedTerm.trim();
    const reading = fb.suggestedReading.trim();
    if (!term || !reading) continue;

    const inner = readingCount.get(term) ?? new Map<string, number>();
    inner.set(reading, (inner.get(reading) ?? 0) + 1);
    readingCount.set(term, inner);
  }

  // CorrectionResult から ASR ミスマッチパターンを抽出
  const corrections = await prisma.correctionResult.findMany({
    where: { domainId },
    select: { layer1Result: true },
  });

  for (const cr of corrections) {
    if (!cr.layer1Result) continue;
    try {
      const layer1 = JSON.parse(cr.layer1Result) as Array<{
        candidates?: Array<{ prefLabel: string; phoneticHint: string; originalText: string }>;
      }>;
      for (const seg of layer1) {
        for (const cand of seg.candidates ?? []) {
          // originalText が phoneticHint と異なれば読み仮名ミスマッチ候補
          if (
            cand.originalText &&
            cand.phoneticHint &&
            cand.originalText !== cand.phoneticHint &&
            /^[\u30A0-\u30FF]+$/.test(cand.originalText) // カタカナのみ
          ) {
            const inner = readingCount.get(cand.prefLabel) ?? new Map<string, number>();
            inner.set(cand.originalText, (inner.get(cand.originalText) ?? 0) + 1);
            readingCount.set(cand.prefLabel, inner);
          }
        }
      }
    } catch {
      // JSON parse failure is ignorable
    }
  }

  const result: EvolutionResult['newPhonetics'] = [];

  for (const [termLabel, readings] of Array.from(readingCount.entries())) {
    // θ₂以上出現した読みのみ対象
    const newReadings: string[] = [];
    for (const [reading, count] of Array.from(readings.entries())) {
      if (count >= minOccurrences) newReadings.push(reading);
    }
    if (newReadings.length === 0) continue;

    // 既存エンティティを検索
    const entity = await prisma.ontologyEntity.findUnique({
      where: { domainId_prefLabel: { domainId, prefLabel: termLabel } },
    });
    if (!entity) continue;

    const existingHints = JSON.parse(entity.phoneticHints) as string[];
    const toAdd = newReadings.filter((r) => !existingHints.includes(r));
    if (toAdd.length === 0) continue;

    if (autoApprove) {
      await prisma.ontologyEntity.update({
        where: { id: entity.id },
        data: { phoneticHints: JSON.stringify([...existingHints, ...toAdd]) },
      });
    }

    result.push({ entityId: entity.id, prefLabel: termLabel, addedHints: toAdd });
  }

  return result;
}

// ---------- 進化操作3: 関係推定 ----------

async function evolveRelations(
  domainId: string,
  minOccurrences: number,
  autoApprove: boolean,
  entityLabelToId: Map<string, string>
): Promise<EvolutionResult['newRelations']> {
  // CorrectionResult から共起分析
  const corrections = await prisma.correctionResult.findMany({
    where: { domainId },
    select: { layer2Result: true, correctedText: true },
  });

  const cooccurrence = new Map<string, number>(); // "labelA||labelB" -> count

  const entityLabels = Array.from(entityLabelToId.keys());

  for (const cr of corrections) {
    const text = cr.correctedText ?? '';
    if (!text) continue;

    // セグメントテキストに含まれるエンティティを検出
    const found: string[] = [];
    for (const label of entityLabels) {
      if (text.includes(label)) found.push(label);
    }

    // 検出された全ペアを共起カウント
    for (let i = 0; i < found.length; i++) {
      for (let j = i + 1; j < found.length; j++) {
        const key = [found[i], found[j]].sort().join('||');
        cooccurrence.set(key, (cooccurrence.get(key) ?? 0) + 1);
      }
    }
  }

  // θ₂以上の共起ペアを候補とする
  const candidates: Array<{ labelA: string; labelB: string; count: number }> = [];
  for (const [key, count] of Array.from(cooccurrence.entries())) {
    if (count >= minOccurrences) {
      const [labelA, labelB] = key.split('||');
      candidates.push({ labelA, labelB, count });
    }
  }

  if (candidates.length === 0) return [];

  // LLMで関係タイプを推定
  const domain = await prisma.domain.findUnique({ where: { id: domainId } });

  const prompt = `ドメイン「${domain?.name}」（${domain?.description}）において、
以下のエンティティペアの関係タイプを推定してください。

【ペア一覧】
${candidates.map((c) => `- ${c.labelA} ↔ ${c.labelB}（共起回数: ${c.count}）`).join('\n')}

各ペアについてJSON配列で返してください（コードブロックなし）:
[
  {
    "from": "エンティティA",
    "to": "エンティティB",
    "type": "broader|narrower|isPartOf|isUsedIn|relatedTo",
    "confidence": 0.0〜1.0
  }
]`;

  let inferredRelations: Array<{
    from: string;
    to: string;
    type: string;
    confidence: number;
  }> = [];

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    const text = res.choices[0]?.message?.content ?? '[]';
    inferredRelations = JSON.parse(text);
  } catch {
    // LLM失敗時は共起関係として登録
    inferredRelations = candidates.map((c) => ({
      from: c.labelA,
      to: c.labelB,
      type: 'relatedTo',
      confidence: 0.5,
    }));
  }

  const result: EvolutionResult['newRelations'] = [];

  for (const rel of inferredRelations) {
    const fromId = entityLabelToId.get(rel.from);
    const toId = entityLabelToId.get(rel.to);
    if (!fromId || !toId || fromId === toId) continue;

    if (autoApprove) {
      await prisma.ontologyRelation.upsert({
        where: {
          fromEntityId_toEntityId_relationType: {
            fromEntityId: fromId,
            toEntityId: toId,
            relationType: rel.type,
          },
        },
        update: {
          cooccurrenceWeight: rel.confidence,
          source: 'feedback',
        },
        create: {
          fromEntityId: fromId,
          toEntityId: toId,
          relationType: rel.type,
          cooccurrenceWeight: rel.confidence,
          source: 'feedback',
        },
      });
    }

    result.push({ from: rel.from, to: rel.to, type: rel.type, confidence: rel.confidence });
  }

  return result;
}

// ---------- スナップショット自動作成 ----------

async function createAutoSnapshot(domainId: string): Promise<void> {
  const entities = await prisma.ontologyEntity.findMany({ where: { domainId } });
  const relations = await prisma.ontologyRelation.findMany({
    where: { fromEntity: { domainId } },
    include: {
      fromEntity: { select: { prefLabel: true } },
      toEntity: { select: { prefLabel: true } },
    },
  });
  const domain = await prisma.domain.findUnique({ where: { id: domainId } });

  // 現在の週番号を算出（最新スナップショットの weekNumber + 1）
  const latestSnapshot = await prisma.ontologySnapshot.findFirst({
    where: { domainId },
    orderBy: { weekNumber: 'desc' },
  });
  const weekNumber = (latestSnapshot?.weekNumber ?? 0) + 1;

  const snapshotData = JSON.stringify({
    domain: domain?.name,
    description: domain?.description,
    exportedAt: new Date().toISOString(),
    mode: 'auto_evolution',
    entities: entities.map((e) => ({
      prefLabel: e.prefLabel,
      altLabels: JSON.parse(e.altLabels),
      phoneticHints: JSON.parse(e.phoneticHints),
      definition: e.definition,
      category: e.category,
      source: e.source,
    })),
    relations: relations.map((r) => ({
      from: r.fromEntity.prefLabel,
      to: r.toEntity.prefLabel,
      type: r.relationType,
      weight: r.cooccurrenceWeight,
      source: r.source,
    })),
  });

  await prisma.ontologySnapshot.upsert({
    where: { domainId_weekNumber: { domainId, weekNumber } },
    update: {
      label: `week${weekNumber}_auto`,
      data: snapshotData,
      entityCount: entities.length,
      relationCount: relations.length,
    },
    create: {
      domainId,
      weekNumber,
      label: `week${weekNumber}_auto`,
      data: snapshotData,
      entityCount: entities.length,
      relationCount: relations.length,
    },
  });
}

// ---------- メイン: executeEvolution ----------

export async function executeEvolution(
  domainId: string,
  options?: EvolutionOptions
): Promise<EvolutionResult> {
  const minOccurrences = options?.minOccurrences ?? 3;
  const autoApprove = options?.autoApprove ?? false;

  // フィードバック件数を確認
  const feedbackCount = await prisma.feedback.count({ where: { domainId } });

  // 既存エンティティを取得
  const existingEntities = await prisma.ontologyEntity.findMany({
    where: { domainId, isActive: true },
    select: { id: true, prefLabel: true, altLabels: true },
  });

  const existingLabels = new Set<string>();
  const entityLabelToId = new Map<string, string>();
  for (const e of existingEntities) {
    existingLabels.add(e.prefLabel);
    entityLabelToId.set(e.prefLabel, e.id);
    for (const alt of JSON.parse(e.altLabels) as string[]) {
      existingLabels.add(alt);
    }
  }

  // 3つの進化操作を実行
  const [newEntities, newPhonetics, newRelations] = await Promise.all([
    evolveNewEntities(domainId, minOccurrences, autoApprove, existingLabels),
    evolvePhonetics(domainId, minOccurrences, autoApprove),
    evolveRelations(domainId, minOccurrences, autoApprove, entityLabelToId),
  ]);

  // autoApprove=true の場合、スナップショットを自動作成
  if (autoApprove) {
    await createAutoSnapshot(domainId);
  }

  return {
    newEntities,
    newPhonetics,
    newRelations,
    stats: {
      feedbacksProcessed: feedbackCount,
      entitiesAdded: autoApprove ? newEntities.filter((e) => e.status === 'added').length : 0,
      phoneticsAdded: autoApprove ? newPhonetics.reduce((s, p) => s + p.addedHints.length, 0) : 0,
      relationsInferred: newRelations.length,
    },
  };
}
