import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  // 環境変数から読む（未設定ならデフォルト値）
  // 本番では .env に SEED_USER_PASSWORD / SEED_ADMIN_PASSWORD を設定してください
  const userPassword = process.env.SEED_USER_PASSWORD || 'changeme';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  const users = ['test1', 'test2', 'test3'];

  for (const username of users) {
    const passwordHash = await bcrypt.hash(userPassword, 10);
    await prisma.user.upsert({
      where: { username },
      update: { passwordHash },
      create: { username, passwordHash },
    });
  }

  const adminHash = await bcrypt.hash(adminPassword, 10);
  await prisma.adminUser.upsert({
    where: { username: 'admin' },
    update: { passwordHash: adminHash },
    create: { username: 'admin', passwordHash: adminHash, role: 'admin' },
  });

  console.log('Seed completed (user password from SEED_USER_PASSWORD, admin password from SEED_ADMIN_PASSWORD)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
