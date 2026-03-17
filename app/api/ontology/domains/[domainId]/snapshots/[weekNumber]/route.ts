import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: { domainId: string; weekNumber: string } }
) {
  const user = await authenticateBasicAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const weekNumber = parseInt(params.weekNumber, 10);
  if (isNaN(weekNumber)) {
    return NextResponse.json({ error: 'Invalid weekNumber' }, { status: 400 });
  }

  const snapshot = await prisma.ontologySnapshot.findUnique({
    where: { domainId_weekNumber: { domainId: params.domainId, weekNumber } },
  });

  if (!snapshot) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
  return NextResponse.json(snapshot);
}
