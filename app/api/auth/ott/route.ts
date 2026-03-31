import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';
import { generateOtt } from '@/lib/ott';

export async function POST(req: NextRequest) {
  const user = await authenticateBasicAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = generateOtt(user.id, user.username);
  return NextResponse.json({ token });
}
