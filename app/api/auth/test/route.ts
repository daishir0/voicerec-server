import { NextRequest, NextResponse } from 'next/server';
import { authenticateBasicAuth } from '@/lib/basic-auth';

export async function POST(req: NextRequest) {
  const user = await authenticateBasicAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, username: user.username });
}
