import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { generateOtt } from '@/lib/ott';

export async function POST(req: NextRequest) {
  const user = await authenticateBearer(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = generateOtt(user.id, user.username);
  return NextResponse.json({ token });
}
