import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';
import { extractTermsFromText } from '@/lib/bootstrap';

export async function POST(req: NextRequest, { params }: { params: { domainId: string } }) {
  const user = await authenticateBearer(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { domainId } = params;

  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });

  const body = await req.json();
  const { recordingIds, model = 'gpt-4o', dryRun = false } = body;

  // 指定されたrecordingIds（または全録音）のtranscriptionTextを取得
  const recordings = await prisma.recording.findMany({
    where: {
      transcriptionStatus: 'completed',
      transcriptionText: { not: null },
      ...(Array.isArray(recordingIds) && recordingIds.length > 0
        ? { id: { in: recordingIds } }
        : {}),
    },
    select: { id: true, transcriptionText: true },
  });

  if (recordings.length === 0) {
    return NextResponse.json({ error: 'No transcribed recordings found' }, { status: 400 });
  }

  const combinedText = recordings
    .map((r) => r.transcriptionText ?? '')
    .filter((t) => t.length > 0)
    .join('\n\n');

  if (combinedText.trim().length === 0) {
    return NextResponse.json({ error: 'No transcription text available' }, { status: 400 });
  }

  // 既存エンティティを取得（重複排除用）
  const existingEntities = await prisma.ontologyEntity.findMany({
    where: { domainId },
    select: { prefLabel: true },
  });
  const existingTerms = existingEntities.map((e) => e.prefLabel);

  const result = await extractTermsFromText(
    combinedText,
    domain.name,
    domain.description,
    existingTerms,
    model
  );

  let newTerms = 0;
  let skippedDuplicates = 0;
  let savedRelations = 0;

  if (!dryRun) {
    const existingSet = new Set(existingTerms.map((t) => t.toLowerCase()));

    for (const term of result.terms) {
      if (existingSet.has(term.prefLabel.toLowerCase())) {
        skippedDuplicates++;
        continue;
      }

      await prisma.ontologyEntity.upsert({
        where: { domainId_prefLabel: { domainId, prefLabel: term.prefLabel } },
        update: {},
        create: {
          domainId,
          prefLabel: term.prefLabel,
          altLabels: JSON.stringify(term.altLabels ?? []),
          phoneticHints: JSON.stringify(term.phoneticHints ?? []),
          definition: term.definition ?? null,
          category: term.category ?? null,
          source: 'bootstrap',
        },
      });
      newTerms++;
    }

    for (const rel of result.relations) {
      const fromEntity = await prisma.ontologyEntity.findUnique({
        where: { domainId_prefLabel: { domainId, prefLabel: rel.fromLabel } },
      });
      const toEntity = await prisma.ontologyEntity.findUnique({
        where: { domainId_prefLabel: { domainId, prefLabel: rel.toLabel } },
      });

      if (!fromEntity || !toEntity) continue;

      await prisma.ontologyRelation.upsert({
        where: {
          fromEntityId_toEntityId_relationType: {
            fromEntityId: fromEntity.id,
            toEntityId: toEntity.id,
            relationType: rel.relationType,
          },
        },
        update: {},
        create: {
          fromEntityId: fromEntity.id,
          toEntityId: toEntity.id,
          relationType: rel.relationType,
          cooccurrenceWeight: rel.confidence ?? 0,
          source: 'bootstrap',
        },
      });
      savedRelations++;
    }
  }

  return NextResponse.json({
    domainId,
    dryRun,
    recordingsUsed: recordings.map((r) => r.id),
    result: {
      terms: result.terms,
      relations: result.relations,
      stats: {
        ...result.stats,
        newTerms: dryRun ? result.stats.totalTerms : newTerms,
        skippedDuplicates: dryRun ? 0 : skippedDuplicates,
        savedRelations: dryRun ? 0 : savedRelations,
      },
    },
  });
}
