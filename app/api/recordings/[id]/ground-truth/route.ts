import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';

interface DomainEntity {
  text: string;
  entityId?: string;
  startPos: number;
  endPos: number;
}

interface GTSegment {
  segmentIndex: number;
  text: string;
  domainEntities: DomainEntity[];
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authenticateBasicAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const recording = await prisma.recording.findUnique({ where: { id: params.id } });
    if (!recording || recording.userId !== user.id) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    const body = await req.json();
    const { domainId, annotatorId, segments } = body;

    if (!domainId) {
      return NextResponse.json({ error: 'domainId is required' }, { status: 400 });
    }
    if (!annotatorId) {
      return NextResponse.json({ error: 'annotatorId is required' }, { status: 400 });
    }
    if (!Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json({ error: 'segments must be a non-empty array' }, { status: 400 });
    }

    // Validate segment structure
    for (const seg of segments as GTSegment[]) {
      if (typeof seg.segmentIndex !== 'number' || typeof seg.text !== 'string') {
        return NextResponse.json(
          { error: 'Each segment must have segmentIndex (number) and text (string)' },
          { status: 400 }
        );
      }
    }

    const domain = await prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
    }

    const gt = await prisma.groundTruth.upsert({
      where: {
        recordingId_domainId_annotatorId: {
          recordingId: params.id,
          domainId,
          annotatorId,
        },
      },
      update: {
        segments: JSON.stringify(segments),
      },
      create: {
        recordingId: params.id,
        domainId,
        annotatorId,
        segments: JSON.stringify(segments),
      },
    });

    return NextResponse.json({
      id: gt.id,
      recordingId: gt.recordingId,
      domainId: gt.domainId,
      annotatorId: gt.annotatorId,
      segments: JSON.parse(gt.segments),
      createdAt: gt.createdAt,
      updatedAt: gt.updatedAt,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[GroundTruth POST Error]', err?.message);
    return NextResponse.json(
      { error: 'Internal server error', message: err?.message },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authenticateBasicAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const recording = await prisma.recording.findUnique({ where: { id: params.id } });
    if (!recording || recording.userId !== user.id) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const domainId = searchParams.get('domainId');
    const annotatorId = searchParams.get('annotatorId');

    if (!domainId) {
      return NextResponse.json({ error: 'domainId is required' }, { status: 400 });
    }

    if (annotatorId) {
      const gt = await prisma.groundTruth.findUnique({
        where: {
          recordingId_domainId_annotatorId: {
            recordingId: params.id,
            domainId,
            annotatorId,
          },
        },
      });
      if (!gt) {
        return NextResponse.json({ error: 'Ground truth not found' }, { status: 404 });
      }
      return NextResponse.json({
        id: gt.id,
        recordingId: gt.recordingId,
        domainId: gt.domainId,
        annotatorId: gt.annotatorId,
        segments: JSON.parse(gt.segments),
        createdAt: gt.createdAt,
        updatedAt: gt.updatedAt,
      });
    }

    // 全アノテーター
    const gts = await prisma.groundTruth.findMany({
      where: { recordingId: params.id, domainId },
      orderBy: { annotatorId: 'asc' },
    });

    return NextResponse.json(
      gts.map((gt) => ({
        id: gt.id,
        recordingId: gt.recordingId,
        domainId: gt.domainId,
        annotatorId: gt.annotatorId,
        segments: JSON.parse(gt.segments),
        createdAt: gt.createdAt,
        updatedAt: gt.updatedAt,
      }))
    );
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[GroundTruth GET Error]', err?.message);
    return NextResponse.json(
      { error: 'Internal server error', message: err?.message },
      { status: 500 }
    );
  }
}
