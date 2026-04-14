import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';
import { runExperiment } from '@/app/api/recordings/[id]/experiment/route';

type ExperimentCondition =
  | 'B1'
  | 'B2'
  | 'B3'
  | 'proposed'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5';

const VALID_CONDITIONS: ExperimentCondition[] = [
  'B1', 'B2', 'B3', 'proposed', 'A1', 'A2', 'A3', 'A4', 'A5',
];

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateBearer(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { domainId, recordingIds, conditions, snapshotWeek } = body;

    // バリデーション
    if (!domainId) {
      return NextResponse.json({ error: 'domainId is required' }, { status: 400 });
    }
    if (!Array.isArray(recordingIds) || recordingIds.length === 0) {
      return NextResponse.json(
        { error: 'recordingIds must be a non-empty array' },
        { status: 400 }
      );
    }
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return NextResponse.json(
        { error: 'conditions must be a non-empty array' },
        { status: 400 }
      );
    }

    const invalidConditions = conditions.filter(
      (c: string) => !VALID_CONDITIONS.includes(c as ExperimentCondition)
    );
    if (invalidConditions.length > 0) {
      return NextResponse.json(
        {
          error: `Invalid conditions: ${invalidConditions.join(', ')}. Valid: ${VALID_CONDITIONS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const domain = await prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
    }

    // 対象録音を取得（ユーザー権限チェック含む）
    const recordings = await prisma.recording.findMany({
      where: { id: { in: recordingIds }, userId: user.id },
      select: { id: true, transcriptionSegments: true },
    });

    const recordingMap = new Map(recordings.map((r) => [r.id, r]));

    const totalStart = Date.now();
    const results: Array<{
      recordingId: string;
      condition: string;
      status: 'completed' | 'failed' | 'skipped';
      totalCorrections?: number;
      totalTimeMs?: number;
      error?: string;
    }> = [];

    // recordingIds × conditions の全組み合わせを逐次実行
    for (const recordingId of recordingIds) {
      const recording = recordingMap.get(recordingId);

      if (!recording) {
        for (const condition of conditions) {
          results.push({
            recordingId,
            condition,
            status: 'failed',
            error: 'Recording not found or access denied',
          });
        }
        continue;
      }

      if (!recording.transcriptionSegments) {
        for (const condition of conditions) {
          results.push({
            recordingId,
            condition,
            status: 'skipped',
            error: 'Transcription not completed',
          });
        }
        continue;
      }

      let segments: Array<{ text: string; start: number; end: number }>;
      try {
        segments = JSON.parse(recording.transcriptionSegments);
      } catch {
        for (const condition of conditions) {
          results.push({
            recordingId,
            condition,
            status: 'failed',
            error: 'Invalid transcriptionSegments format',
          });
        }
        continue;
      }

      if (!segments || segments.length === 0) {
        for (const condition of conditions) {
          results.push({
            recordingId,
            condition,
            status: 'skipped',
            error: 'Transcription segments are empty',
          });
        }
        continue;
      }

      for (const condition of conditions as ExperimentCondition[]) {
        try {
          const expResult = await runExperiment(
            recordingId,
            domainId,
            condition,
            segments,
            snapshotWeek ?? undefined
          );

          results.push({
            recordingId,
            condition,
            status: 'completed',
            totalCorrections: expResult.stats.totalCorrections,
            totalTimeMs: expResult.stats.totalTimeMs,
          });
        } catch (err: unknown) {
          const error = err as Error;
          console.error(`[Batch] failed recordingId=${recordingId} condition=${condition}:`, error?.message);
          results.push({
            recordingId,
            condition,
            status: 'failed',
            error: error?.message ?? 'Unknown error',
          });
        }
      }
    }

    const totalTimeMs = Date.now() - totalStart;
    const completed = results.filter((r) => r.status === 'completed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;

    return NextResponse.json({
      results,
      stats: {
        totalExperiments: results.length,
        completed,
        failed,
        skipped,
        totalTimeMs,
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Batch Experiment API Error]', err?.message, err?.stack);
    return NextResponse.json(
      { error: 'Internal server error', message: err?.message },
      { status: 500 }
    );
  }
}
