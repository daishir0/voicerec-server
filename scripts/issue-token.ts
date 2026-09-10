/**
 * 外部クライアント用の Bearer トークン (MobileToken) を発行するスクリプト。
 *
 * 平文トークンは発行時にこの1回しか表示できない (DB には SHA-256 ハッシュのみ保存)。
 * 標準出力に平文を出すので、リダイレクト先のファイルは必ず chmod 600 にすること。
 *
 * 実行例:
 *   cd srv18083 && npx tsx scripts/issue-token.ts --user=test1 --label=papernote
 *   cd srv18083 && npx tsx scripts/issue-token.ts --user=test1 --label=papernote --quiet > token.txt
 *
 * オプション:
 *   --user=<username>   発行先ユーザー名 (必須)
 *   --label=<text>      deviceLabel。後から識別・失効するために付ける (必須)
 *   --quiet             平文トークンだけを出力する (ファイルへリダイレクトする用)
 *   --list              発行済みトークンの一覧を表示して終了 (平文は出ない)
 *   --revoke=<id>       指定 MobileToken.id を失効させて終了
 */

import { prisma } from '../lib/db';
import { issueMobileToken } from '../lib/bearer-auth';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const revokeId = arg('revoke');
  if (revokeId) {
    const updated = await prisma.mobileToken.update({
      where: { id: revokeId },
      data: { revokedAt: new Date() },
      include: { user: true },
    });
    console.log(`revoked: id=${updated.id} user=${updated.user.username} label=${updated.deviceLabel ?? '(none)'}`);
    return;
  }

  if (flag('list')) {
    const tokens = await prisma.mobileToken.findMany({
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });
    for (const t of tokens) {
      const state = t.revokedAt ? 'REVOKED' : 'active';
      console.log(
        `${t.id}  ${t.user.username.padEnd(8)} ${state.padEnd(8)} ` +
        `label=${t.deviceLabel ?? '(none)'} created=${t.createdAt.toISOString()} ` +
        `lastUsed=${t.lastUsedAt?.toISOString() ?? '-'}`,
      );
    }
    console.log(`\n${tokens.length} token(s)`);
    return;
  }

  const username = arg('user');
  const label = arg('label');
  if (!username || !label) {
    console.error('usage: npx tsx scripts/issue-token.ts --user=<username> --label=<text> [--quiet]');
    console.error('       npx tsx scripts/issue-token.ts --list');
    console.error('       npx tsx scripts/issue-token.ts --revoke=<mobileTokenId>');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`user not found: ${username}`);
    process.exitCode = 1;
    return;
  }

  const token = await issueMobileToken(user.id, label);

  if (flag('quiet')) {
    console.log(token);
    return;
  }

  console.log(`user     : ${user.username} (role=${user.role})`);
  console.log(`label    : ${label}`);
  console.log(`token    : ${token}`);
  console.log('\nこの平文は再表示できません。保存先は chmod 600 にしてください。');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
