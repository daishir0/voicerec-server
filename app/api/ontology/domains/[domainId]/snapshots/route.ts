import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: { domainId: string } }) {
  const user = await authenticateBasicAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const snapshots = await prisma.ontologySnapshot.findMany({
    where: { domainId: params.domainId },
    orderBy: { weekNumber: 'asc' },
  });

  return NextResponse.json(snapshots);
}
