import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const user = await authenticateBasicAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const recordings = await prisma.recording.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(recordings);
}
