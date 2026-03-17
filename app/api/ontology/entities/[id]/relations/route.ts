import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBasicAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const relations = await prisma.ontologyRelation.findMany({
    where: {
      OR: [{ fromEntityId: params.id }, { toEntityId: params.id }],
    },
    include: {
      fromEntity: { select: { id: true, prefLabel: true } },
      toEntity: { select: { id: true, prefLabel: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(relations);
}
