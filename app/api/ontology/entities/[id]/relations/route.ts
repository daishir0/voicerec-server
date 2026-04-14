import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBearer(req);
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
