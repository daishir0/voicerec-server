import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authenticateBearer(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const recording = await prisma.recording.findUnique({ where: { id: params.id } });
    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    const body = await req.json();
    const {
      domainId,
      segmentIndex,
      feedbackType,
      originalText,
      correctedText,
      suggestedTerm,
      suggestedReading,
      comment,
    } = body;

    if (!domainId) {
      return NextResponse.json({ error: 'domainId is required' }, { status: 400 });
    }
    if (typeof segmentIndex !== 'number') {
      return NextResponse.json({ error: 'segmentIndex is required' }, { status: 400 });
    }
    if (!feedbackType || !['approve', 'reject', 'suggest_term', 'suggest_correction'].includes(feedbackType)) {
      return NextResponse.json(
        { error: 'feedbackType must be one of: approve, reject, suggest_term, suggest_correction' },
        { status: 400 }
      );
    }
    if (!originalText) {
      return NextResponse.json({ error: 'originalText is required' }, { status: 400 });
    }

    const domain = await prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
    }

    const feedback = await prisma.feedback.create({
      data: {
        recordingId: params.id,
        domainId,
        userId: user.id,
        segmentIndex,
        feedbackType,
        originalText,
        correctedText: correctedText ?? null,
        suggestedTerm: suggestedTerm ?? null,
        suggestedReading: suggestedReading ?? null,
        comment: comment ?? null,
      },
    });

    return NextResponse.json(feedback, { status: 201 });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Feedback POST Error]', err?.message);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authenticateBearer(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const recording = await prisma.recording.findUnique({ where: { id: params.id } });
    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const domainId = searchParams.get('domainId');

    const feedbacks = await prisma.feedback.findMany({
      where: {
        recordingId: params.id,
        ...(domainId ? { domainId } : {}),
      },
      orderBy: [{ segmentIndex: 'asc' }, { createdAt: 'asc' }],
      include: {
        user: { select: { id: true, username: true } },
        domain: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(feedbacks);
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Feedback GET Error]', err?.message);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
