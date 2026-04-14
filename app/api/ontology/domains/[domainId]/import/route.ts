import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: { domainId: string } }) {
  const user = await authenticateBearer(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { domainId } = params;

  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });

  const body = await req.json();
  const { entities = [], relations = [], terms = [] } = body;

  // flat format support
  const entityList = entities.length > 0 ? entities : terms;

  let importedEntities = 0;
  let importedRelations = 0;

  for (const e of entityList) {
    const { prefLabel, altLabels = [], phoneticHints = [], definition, category, source = 'manual' } = e;
    if (!prefLabel) continue;

    await prisma.ontologyEntity.upsert({
      where: { domainId_prefLabel: { domainId, prefLabel } },
      update: {
        altLabels: JSON.stringify(altLabels),
        phoneticHints: JSON.stringify(phoneticHints),
        definition,
        category,
      },
      create: {
        domainId,
        prefLabel,
        altLabels: JSON.stringify(altLabels),
        phoneticHints: JSON.stringify(phoneticHints),
        definition,
        category,
        source,
      },
    });
    importedEntities++;
  }

  for (const r of relations) {
    const { from, to, type, weight = 0, source = 'manual' } = r;
    if (!from || !to || !type) continue;

    const fromEntity = await prisma.ontologyEntity.findUnique({
      where: { domainId_prefLabel: { domainId, prefLabel: from } },
    });
    const toEntity = await prisma.ontologyEntity.findUnique({
      where: { domainId_prefLabel: { domainId, prefLabel: to } },
    });

    if (!fromEntity || !toEntity) continue;

    await prisma.ontologyRelation.upsert({
      where: {
        fromEntityId_toEntityId_relationType: {
          fromEntityId: fromEntity.id,
          toEntityId: toEntity.id,
          relationType: type,
        },
      },
      update: { cooccurrenceWeight: weight },
      create: {
        fromEntityId: fromEntity.id,
        toEntityId: toEntity.id,
        relationType: type,
        cooccurrenceWeight: weight,
        source,
      },
    });
    importedRelations++;
  }

  return NextResponse.json({ imported: { entities: importedEntities, relations: importedRelations } });
}
