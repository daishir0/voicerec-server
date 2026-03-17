import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { prisma } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBasicAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { prefLabel, altLabels, phoneticHints, definition, category, isActive, source } = body;

  const entity = await prisma.ontologyEntity.update({
    where: { id: params.id },
    data: {
      ...(prefLabel !== undefined && { prefLabel }),
      ...(altLabels !== undefined && { altLabels: JSON.stringify(altLabels) }),
      ...(phoneticHints !== undefined && { phoneticHints: JSON.stringify(phoneticHints) }),
      ...(definition !== undefined && { definition }),
      ...(category !== undefined && { category }),
      ...(isActive !== undefined && { isActive }),
      ...(source !== undefined && { source }),
    },
  });

  return NextResponse.json({
    ...entity,
    altLabels: JSON.parse(entity.altLabels),
    phoneticHints: JSON.parse(entity.phoneticHints),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBasicAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await prisma.ontologyEntity.delete({ where: { id: params.id } });
  return NextResponse.json({ deleted: true });
}
