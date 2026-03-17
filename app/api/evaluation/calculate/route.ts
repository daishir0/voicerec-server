import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';
import { calculateCER } from '@/lib/evaluation';

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateBasicAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { recordingId, domainId, conditions, annotatorId } = body;

    if (!recordingId) {
      return NextResponse.json({ error: 'recordingId is required' }, { status: 400 });
    }
    if (!domainId) {
      return NextResponse.json({ error: 'domainId is required' }, { status: 400 });
    }
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return NextResponse.json({ error: 'conditions must be a non-empty array' }, { status: 400 });
    }

    // 録音の存在確認（所有者チェックなし — 管理者も呼べるよう緩める）
    const recording = await prisma.recording.findUnique({ where: { id: recordingId } });
    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    const domain = await prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
    }

    const results: Record<string, {
      cerDE: number;
      cerGEN: number;
      cerTotal: number;
      dkdpRatio: number;
      entityCount: number;
    }> = {};

    const errors: Record<string, string> = {};

    for (const condition of conditions as string[]) {
      try {
        const cerResult = await calculateCER(recordingId, domainId, condition, annotatorId);

        // EvaluationResult に永続化（upsert）
        await prisma.evaluationResult.upsert({
          where: {
            recordingId_domainId_condition_annotatorId: {
              recordingId,
              domainId,
              condition,
              annotatorId: annotatorId ?? 'annotator1',
            },
          },
          update: {
            cerDE: cerResult.cerDE,
            cerGEN: cerResult.cerGEN,
            cerTotal: cerResult.cerTotal,
            dkdpRatio: cerResult.dkdpRatio,
            entityCount: cerResult.entityCount,
            details: JSON.stringify(cerResult.details),
          },
          create: {
            recordingId,
            domainId,
            condition,
            annotatorId: annotatorId ?? 'annotator1',
            cerDE: cerResult.cerDE,
            cerGEN: cerResult.cerGEN,
            cerTotal: cerResult.cerTotal,
            dkdpRatio: cerResult.dkdpRatio,
            entityCount: cerResult.entityCount,
            details: JSON.stringify(cerResult.details),
          },
        });

        results[condition] = {
          cerDE: cerResult.cerDE,
          cerGEN: cerResult.cerGEN,
          cerTotal: cerResult.cerTotal,
          dkdpRatio: cerResult.dkdpRatio,
          entityCount: cerResult.entityCount,
        };
      } catch (err: unknown) {
        const e = err as Error;
        errors[condition] = e?.message ?? 'Unknown error';
      }
    }

    const response: {
      recordingId: string;
      domainId: string;
      results: typeof results;
      errors?: typeof errors;
    } = { recordingId, domainId, results };

    if (Object.keys(errors).length > 0) {
      response.errors = errors;
    }

    return NextResponse.json(response);
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Evaluation Calculate Error]', err?.message);
    return NextResponse.json(
      { error: 'Internal server error', message: err?.message },
      { status: 500 }
    );
  }
}
