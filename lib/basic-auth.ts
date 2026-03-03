import { NextRequest } from 'next/server';
import { prisma } from './db';
import bcrypt from 'bcryptjs';

export async function authenticateBasicAuth(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Basic ')) return null;

  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
  const [username, password] = decoded.split(':');
  if (!username || !password) return null;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}
