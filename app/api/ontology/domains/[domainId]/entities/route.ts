import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: { domainId: string } }) {
  const user = await authenticateBasicAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { domainId } = params;
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  const entities = await prisma.ontologyEntity.findMany({
    where: {
      domainId,
      ...(q
        ? {
            OR: [
              { prefLabel: { contains: q } },
              { altLabels: { contains: q } },
            ],
          }
        : {}),
    },
    include: {
      _count: { select: { relationsFrom: true, relationsTo: true } },
    },
    orderBy: { prefLabel: 'asc' },
  });

  return NextResponse.json(
    entities.map((e) => ({
      ...e,
      altLabels: JSON.parse(e.altLabels),
      phoneticHints: JSON.parse(e.phoneticHints),
      relationCount: e._count.relationsFrom + e._count.relationsTo,
    }))
  );
}

export async function POST(req: NextRequest, { params }: { params: { domainId: string } }) {
  const user = await authenticateBasicAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { domainId } = params;
  const body = await req.json();
  const { prefLabel, altLabels = [], phoneticHints = [], definition, category, source = 'manual' } = body;

  if (!prefLabel) {
    return NextResponse.json({ error: 'prefLabel is required' }, { status: 400 });
  }

  const entity = await prisma.ontologyEntity.create({
    data: {
      domainId,
      prefLabel,
      altLabels: JSON.stringify(altLabels),
      phoneticHints: JSON.stringify(phoneticHints),
      definition,
      category,
      source,
    },
  });

  return NextResponse.json(
    { ...entity, altLabels: JSON.parse(entity.altLabels), phoneticHints: JSON.parse(entity.phoneticHints) },
    { status: 201 }
  );
}
