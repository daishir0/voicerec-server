import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import fs from 'fs/promises';
import path from 'path';

// GET: ファイル配信（再生用） - 自分の録音のみ
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getUserSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording || recording.userId !== session.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), recording.filePath);
  try {
    const fileBuffer = await fs.readFile(filePath);
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': recording.mimeType || 'audio/mp4',
        'Content-Length': String(fileBuffer.length),
        'Content-Disposition': `inline; filename="${recording.filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
