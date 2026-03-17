import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const user = await authenticateBasicAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { fromEntityId, toEntityId, relationType, cooccurrenceWeight = 0, source = 'manual' } = body;

  if (!fromEntityId || !toEntityId || !relationType) {
    return NextResponse.json(
      { error: 'fromEntityId, toEntityId, relationType are required' },
      { status: 400 }
    );
  }

  const relation = await prisma.ontologyRelation.create({
    data: { fromEntityId, toEntityId, relationType, cooccurrenceWeight, source },
    include: {
      fromEntity: { select: { id: true, prefLabel: true } },
      toEntity: { select: { id: true, prefLabel: true } },
    },
  });

  return NextResponse.json(relation, { status: 201 });
}
