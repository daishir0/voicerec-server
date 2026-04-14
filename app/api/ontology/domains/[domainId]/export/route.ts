import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: { domainId: string } }) {
  const user = await authenticateBearer(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { domainId } = params;
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode') === 'flat' ? 'flat' : 'full';

  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });

  const entities = await prisma.ontologyEntity.findMany({
    where: { domainId, isActive: true },
    orderBy: { prefLabel: 'asc' },
  });

  if (mode === 'flat') {
    return NextResponse.json({
      domain: domain.name,
      description: domain.description,
      exportedAt: new Date().toISOString(),
      mode: 'flat',
      terms: entities.map((e) => ({
        prefLabel: e.prefLabel,
        altLabels: JSON.parse(e.altLabels),
        phoneticHints: JSON.parse(e.phoneticHints),
      })),
    });
  }

  const relations = await prisma.ontologyRelation.findMany({
    where: { fromEntity: { domainId } },
    include: {
      fromEntity: { select: { prefLabel: true } },
      toEntity: { select: { prefLabel: true } },
    },
  });

  return NextResponse.json({
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
}
