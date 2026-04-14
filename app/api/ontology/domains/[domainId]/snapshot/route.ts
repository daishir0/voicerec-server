import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: { domainId: string } }) {
  const user = await authenticateBearer(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { domainId } = params;
  const body = await req.json();
  const { weekNumber, label } = body;

  if (weekNumber === undefined || weekNumber === null) {
    return NextResponse.json({ error: 'weekNumber is required' }, { status: 400 });
  }

  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });

  const entities = await prisma.ontologyEntity.findMany({ where: { domainId } });
  const relations = await prisma.ontologyRelation.findMany({
    where: { fromEntity: { domainId } },
    include: {
      fromEntity: { select: { prefLabel: true } },
      toEntity: { select: { prefLabel: true } },
    },
  });

  const snapshotData = JSON.stringify({
    domain: domain.name,
    description: domain.description,
    exportedAt: new Date().toISOString(),
    mode: 'full',
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

  const snapshot = await prisma.ontologySnapshot.upsert({
    where: { domainId_weekNumber: { domainId, weekNumber } },
    update: {
      label,
      data: snapshotData,
      entityCount: entities.length,
      relationCount: relations.length,
    },
    create: {
      domainId,
      weekNumber,
      label,
      data: snapshotData,
      entityCount: entities.length,
      relationCount: relations.length,
    },
  });

  return NextResponse.json(snapshot, { status: 201 });
}
