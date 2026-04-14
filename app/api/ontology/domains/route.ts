import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const user = await authenticateBearer(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const domains = await prisma.domain.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { entities: true } },
    },
  });

  return NextResponse.json(domains);
}

export async function POST(req: NextRequest) {
  const user = await authenticateBearer(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { name, description } = body;
  if (!name || !description) {
    return NextResponse.json({ error: 'name and description are required' }, { status: 400 });
  }

  const domain = await prisma.domain.create({ data: { name, description } });
  return NextResponse.json(domain, { status: 201 });
}
