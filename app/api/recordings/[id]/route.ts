import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';
import fs from 'fs/promises';
import path from 'path';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBasicAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (recording.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const filePath = path.join(process.cwd(), recording.filePath);
  try {
    await fs.unlink(filePath);
  } catch {
    // file may already be deleted
  }

  await prisma.recording.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
