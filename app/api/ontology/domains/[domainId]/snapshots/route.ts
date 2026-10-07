import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest, props: { params: Promise<{ domainId: string }> }) {
  const params = await props.params;
  const user = await authenticateBearer(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const snapshots = await prisma.ontologySnapshot.findMany({
    where: { domainId: params.domainId },
    orderBy: { weekNumber: 'asc' },
  });

  return NextResponse.json(snapshots);
}
