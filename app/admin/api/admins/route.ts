import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAdminSession } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admins = await prisma.adminUser.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(admins);
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.adminUser.create({ data: { username, passwordHash } });
  return NextResponse.json(admin, { status: 201 });
}
