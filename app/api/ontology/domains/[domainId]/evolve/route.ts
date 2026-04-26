import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';
import { executeEvolution } from '@/lib/evolution';

export async function POST(req: NextRequest, { params }: { params: { domainId: string } }) {
  const user = await authenticateBearer(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { domainId } = params;

  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { minOccurrences = 3, autoApprove = false } = body;

  try {
    const result = await executeEvolution(domainId, { minOccurrences, autoApprove });
    return NextResponse.json({ domainId, result });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Evolve POST Error]', err?.message);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
