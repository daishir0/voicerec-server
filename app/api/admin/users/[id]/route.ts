import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import bcrypt from 'bcryptjs';

const ALLOWED_LANGUAGES = ['ja', 'en', 'zh', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru'];

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  const { username, password, transcriptionLanguage } = await req.json();
  const data: Record<string, string> = {};
  if (username) data.username = username;
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  if (transcriptionLanguage !== undefined) {
    if (typeof transcriptionLanguage !== 'string' || !ALLOWED_LANGUAGES.includes(transcriptionLanguage)) {
      return NextResponse.json(
        { error: `Invalid language. Allowed: ${ALLOWED_LANGUAGES.join(', ')}` },
        { status: 400 }
      );
    }
    data.transcriptionLanguage = transcriptionLanguage;
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      username: true,
      role: true,
      transcriptionLanguage: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json(user);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
