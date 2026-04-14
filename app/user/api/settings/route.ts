import { NextRequest, NextResponse } from 'next/server';
import { getUserSession } from '@/lib/auth';
import { prisma } from '@/lib/db';

const ALLOWED_LANGUAGES = ['ja', 'en', 'zh', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru'];

export async function GET() {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, username: true, transcriptionLanguage: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  return NextResponse.json(user);
}

export async function PATCH(req: NextRequest) {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const body = await req.json();
  const { transcriptionLanguage } = body;

  if (transcriptionLanguage !== undefined) {
    if (typeof transcriptionLanguage !== 'string' || !ALLOWED_LANGUAGES.includes(transcriptionLanguage)) {
      return NextResponse.json(
        { error: `Invalid language. Allowed: ${ALLOWED_LANGUAGES.join(', ')}` },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id: session.userId },
    data: {
      ...(transcriptionLanguage !== undefined ? { transcriptionLanguage } : {}),
    },
    select: { id: true, username: true, transcriptionLanguage: true },
  });
  return NextResponse.json(updated);
}
