import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateBearer(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const domainId = searchParams.get('domainId');
    const condition = searchParams.get('condition');

    const where: {
      domainId?: string;
      condition?: string;
    } = {};
    if (domainId) where.domainId = domainId;
    if (condition) where.condition = condition;

    const results = await prisma.evaluationResult.findMany({
      where,
      orderBy: [{ recordingId: 'asc' }, { condition: 'asc' }],
      include: {
        recording: { select: { displayName: true, originalName: true } },
        domain: { select: { name: true } },
      },
    });

    return NextResponse.json(
      results.map((r) => ({
        id: r.id,
        recordingId: r.recordingId,
        recordingName: r.recording.displayName || r.recording.originalName,
        domainId: r.domainId,
        domainName: r.domain.name,
        condition: r.condition,
        annotatorId: r.annotatorId,
        cerDE: r.cerDE,
        cerGEN: r.cerGEN,
        cerTotal: r.cerTotal,
        dkdpRatio: r.dkdpRatio,
        entityCount: r.entityCount,
        createdAt: r.createdAt,
      }))
    );
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Evaluation Results GET Error]', err?.message);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
