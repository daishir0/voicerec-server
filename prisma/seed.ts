import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
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

  // ドメインシード
  const domains = [
    { name: 'A', description: '複数顧客保守（複数顧客システムの保守・開発チーム進捗）' },
    { name: 'B', description: '特定顧客開発（特定顧客システムの保守・開発）' },
    { name: 'C', description: '本部リーダー（本部リーダー進捗会議）' },
    { name: 'D', description: '大学システム（大学システムの情報共有）' },
  ];

  for (const d of domains) {
    await prisma.domain.upsert({
      where: { name: d.name },
      update: { description: d.description },
      create: { name: d.name, description: d.description },
    });
  }

  const domainA = await prisma.domain.findUnique({ where: { name: 'A' } });
  const domainB = await prisma.domain.findUnique({ where: { name: 'B' } });
  const domainC = await prisma.domain.findUnique({ where: { name: 'C' } });
  const domainD = await prisma.domain.findUnique({ where: { name: 'D' } });

  if (!domainA || !domainB || !domainC || !domainD) {
    throw new Error('Domain seeding failed');
  }

  // ドメインAのエンティティ
  const entitiesA = [
    {
      prefLabel: '顧客管理システム',
      altLabels: JSON.stringify(['CRM', 'カスタマー管理']),
      phoneticHints: JSON.stringify(['こきゃくかんりしすてむ']),
      definition: '顧客情報を一元管理するシステム',
      category: 'システム',
    },
    {
      prefLabel: '障害チケット',
      altLabels: JSON.stringify(['インシデント', 'チケット', 'Issue']),
      phoneticHints: JSON.stringify(['しょうがいちけっと']),
      definition: 'システム障害を管理するチケット',
      category: '運用管理',
    },
    {
      prefLabel: 'SLA',
      altLabels: JSON.stringify(['サービスレベルアグリーメント', 'サービスレベル']),
      phoneticHints: JSON.stringify(['えすえるえー']),
      definition: 'サービス品質保証の合意事項',
      category: '契約管理',
    },
    {
      prefLabel: 'リリース計画',
      altLabels: JSON.stringify(['リリーススケジュール', 'デプロイ計画']),
      phoneticHints: JSON.stringify(['りりーすけいかく']),
      definition: 'システム更新の計画',
      category: 'プロジェクト管理',
    },
  ];

  const createdEntitiesA: { id: string; prefLabel: string }[] = [];
  for (const e of entitiesA) {
    const entity = await prisma.ontologyEntity.upsert({
      where: { domainId_prefLabel: { domainId: domainA.id, prefLabel: e.prefLabel } },
      update: e,
      create: { domainId: domainA.id, ...e },
    });
    createdEntitiesA.push({ id: entity.id, prefLabel: entity.prefLabel });
  }

  // ドメインBのエンティティ
  const entitiesB = [
    {
      prefLabel: 'COBOL',
      altLabels: JSON.stringify(['コボル', 'COBOL言語']),
      phoneticHints: JSON.stringify(['コボル']),
      definition: 'レガシー基幹システムで使用されるプログラミング言語',
      category: 'プログラミング言語',
    },
    {
      prefLabel: 'JCL',
      altLabels: JSON.stringify(['ジョブ制御言語', 'Job Control Language']),
      phoneticHints: JSON.stringify(['じぇーしーえる']),
      definition: 'メインフレームのジョブ制御言語',
      category: 'プログラミング言語',
    },
    {
      prefLabel: '基幹バッチ',
      altLabels: JSON.stringify(['バッチ処理', 'バッチジョブ']),
      phoneticHints: JSON.stringify(['きかんばっち']),
      definition: '業務の基幹となるバッチ処理',
      category: '処理方式',
    },
    {
      prefLabel: 'COBOLジョブ',
      altLabels: JSON.stringify(['COBOLバッチ', 'COBOLプログラム']),
      phoneticHints: JSON.stringify(['コボルじょぶ']),
      definition: 'COBOLで記述されたジョブ',
      category: '処理方式',
    },
  ];

  const createdEntitiesB: { id: string; prefLabel: string }[] = [];
  for (const e of entitiesB) {
    const entity = await prisma.ontologyEntity.upsert({
      where: { domainId_prefLabel: { domainId: domainB.id, prefLabel: e.prefLabel } },
      update: e,
      create: { domainId: domainB.id, ...e },
    });
    createdEntitiesB.push({ id: entity.id, prefLabel: entity.prefLabel });
  }

  // ドメインCのエンティティ
  const entitiesC = [
    {
      prefLabel: '四半期目標',
      altLabels: JSON.stringify(['Q目標', '四半期KPI']),
      phoneticHints: JSON.stringify(['しはんきもくひょう']),
      definition: '四半期ごとに設定する目標',
      category: '目標管理',
    },
    {
      prefLabel: 'KPI',
      altLabels: JSON.stringify(['重要業績評価指標', 'パフォーマンス指標']),
      phoneticHints: JSON.stringify(['けーぴーあい']),
      definition: '業績評価の主要指標',
      category: '評価指標',
    },
    {
      prefLabel: '稼働率',
      altLabels: JSON.stringify(['システム稼働率', 'アップタイム']),
      phoneticHints: JSON.stringify(['かどうりつ']),
      definition: 'システムの稼働時間率',
      category: '評価指標',
    },
  ];

  const createdEntitiesC: { id: string; prefLabel: string }[] = [];
  for (const e of entitiesC) {
    const entity = await prisma.ontologyEntity.upsert({
      where: { domainId_prefLabel: { domainId: domainC.id, prefLabel: e.prefLabel } },
      update: e,
      create: { domainId: domainC.id, ...e },
    });
    createdEntitiesC.push({ id: entity.id, prefLabel: entity.prefLabel });
  }

  // ドメインDのエンティティ
  const entitiesD = [
    {
      prefLabel: '履修登録',
      altLabels: JSON.stringify(['科目登録', '履修申告']),
      phoneticHints: JSON.stringify(['りしゅうとうろく']),
      definition: '学期ごとに受講科目を登録する手続き',
      category: '学務',
    },
    {
      prefLabel: 'シラバス',
      altLabels: JSON.stringify(['講義要綱', '授業計画']),
      phoneticHints: JSON.stringify(['しらばす']),
      definition: '授業の内容・計画を示す文書',
      category: '学務',
    },
    {
      prefLabel: 'LMS',
      altLabels: JSON.stringify(['学習管理システム', 'Learning Management System']),
      phoneticHints: JSON.stringify(['えるえむえす']),
      definition: 'オンライン学習を管理するシステム',
      category: 'システム',
    },
    {
      prefLabel: 'GPA',
      altLabels: JSON.stringify(['成績平均点', 'Grade Point Average']),
      phoneticHints: JSON.stringify(['じーぴーえー']),
      definition: '成績の平均値',
      category: '評価',
    },
  ];

  const createdEntitiesD: { id: string; prefLabel: string }[] = [];
  for (const e of entitiesD) {
    const entity = await prisma.ontologyEntity.upsert({
      where: { domainId_prefLabel: { domainId: domainD.id, prefLabel: e.prefLabel } },
      update: e,
      create: { domainId: domainD.id, ...e },
    });
    createdEntitiesD.push({ id: entity.id, prefLabel: entity.prefLabel });
  }

  // 関係シード
  const getEntityId = (entities: { id: string; prefLabel: string }[], label: string) => {
    const e = entities.find((x) => x.prefLabel === label);
    if (!e) throw new Error(`Entity not found: ${label}`);
    return e.id;
  };

  // ドメインBの関係
  const relationsB = [
    {
      fromEntityId: getEntityId(createdEntitiesB, 'COBOL'),
      toEntityId: getEntityId(createdEntitiesB, '基幹バッチ'),
      relationType: 'isUsedIn',
      cooccurrenceWeight: 0.85,
    },
    {
      fromEntityId: getEntityId(createdEntitiesB, 'JCL'),
      toEntityId: getEntityId(createdEntitiesB, 'COBOLジョブ'),
      relationType: 'controls',
      cooccurrenceWeight: 0.9,
    },
    {
      fromEntityId: getEntityId(createdEntitiesB, 'COBOLジョブ'),
      toEntityId: getEntityId(createdEntitiesB, '基幹バッチ'),
      relationType: 'isPartOf',
      cooccurrenceWeight: 0.75,
    },
  ];

  for (const r of relationsB) {
    await prisma.ontologyRelation.upsert({
      where: {
        fromEntityId_toEntityId_relationType: {
          fromEntityId: r.fromEntityId,
          toEntityId: r.toEntityId,
          relationType: r.relationType,
        },
      },
      update: { cooccurrenceWeight: r.cooccurrenceWeight },
      create: r,
    });
  }

  // ドメインAの関係
  const relationsA = [
    {
      fromEntityId: getEntityId(createdEntitiesA, '障害チケット'),
      toEntityId: getEntityId(createdEntitiesA, 'SLA'),
      relationType: 'relatedTo',
      cooccurrenceWeight: 0.7,
    },
    {
      fromEntityId: getEntityId(createdEntitiesA, '顧客管理システム'),
      toEntityId: getEntityId(createdEntitiesA, '障害チケット'),
      relationType: 'isUsedIn',
      cooccurrenceWeight: 0.8,
    },
  ];

  for (const r of relationsA) {
    await prisma.ontologyRelation.upsert({
      where: {
        fromEntityId_toEntityId_relationType: {
          fromEntityId: r.fromEntityId,
          toEntityId: r.toEntityId,
          relationType: r.relationType,
        },
      },
      update: { cooccurrenceWeight: r.cooccurrenceWeight },
      create: r,
    });
  }

  // ドメインCの関係
  const relationsC = [
    {
      fromEntityId: getEntityId(createdEntitiesC, 'KPI'),
      toEntityId: getEntityId(createdEntitiesC, '四半期目標'),
      relationType: 'relatedTo',
      cooccurrenceWeight: 0.9,
    },
    {
      fromEntityId: getEntityId(createdEntitiesC, '稼働率'),
      toEntityId: getEntityId(createdEntitiesC, 'KPI'),
      relationType: 'isPartOf',
      cooccurrenceWeight: 0.75,
    },
  ];

  for (const r of relationsC) {
    await prisma.ontologyRelation.upsert({
      where: {
        fromEntityId_toEntityId_relationType: {
          fromEntityId: r.fromEntityId,
          toEntityId: r.toEntityId,
          relationType: r.relationType,
        },
      },
      update: { cooccurrenceWeight: r.cooccurrenceWeight },
      create: r,
    });
  }

  // ドメインDの関係
  const relationsD = [
    {
      fromEntityId: getEntityId(createdEntitiesD, 'シラバス'),
      toEntityId: getEntityId(createdEntitiesD, '履修登録'),
      relationType: 'relatedTo',
      cooccurrenceWeight: 0.85,
    },
    {
      fromEntityId: getEntityId(createdEntitiesD, 'LMS'),
      toEntityId: getEntityId(createdEntitiesD, '履修登録'),
      relationType: 'isUsedIn',
      cooccurrenceWeight: 0.8,
    },
  ];

  for (const r of relationsD) {
    await prisma.ontologyRelation.upsert({
      where: {
        fromEntityId_toEntityId_relationType: {
          fromEntityId: r.fromEntityId,
          toEntityId: r.toEntityId,
          relationType: r.relationType,
        },
      },
      update: { cooccurrenceWeight: r.cooccurrenceWeight },
      create: r,
    });
  }

  // Week 0スナップショット作成
  const allDomains = [
    { domain: domainA, entities: createdEntitiesA, relations: relationsA },
    { domain: domainB, entities: createdEntitiesB, relations: relationsB },
    { domain: domainC, entities: createdEntitiesC, relations: relationsC },
    { domain: domainD, entities: createdEntitiesD, relations: relationsD },
  ];

  for (const { domain, entities, relations } of allDomains) {
    const fullEntities = await prisma.ontologyEntity.findMany({
      where: { domainId: domain.id },
    });
    const fullRelations = await prisma.ontologyRelation.findMany({
      where: { fromEntity: { domainId: domain.id } },
      include: { fromEntity: true, toEntity: true },
    });

    const snapshotData = JSON.stringify({
      domain: domain.name,
      description: domain.description,
      exportedAt: new Date().toISOString(),
      mode: 'full',
      entities: fullEntities.map((e) => ({
        prefLabel: e.prefLabel,
        altLabels: JSON.parse(e.altLabels),
        phoneticHints: JSON.parse(e.phoneticHints),
        definition: e.definition,
        category: e.category,
        source: e.source,
      })),
      relations: fullRelations.map((r) => ({
        from: r.fromEntity.prefLabel,
        to: r.toEntity.prefLabel,
        type: r.relationType,
        weight: r.cooccurrenceWeight,
        source: r.source,
      })),
    });

    await prisma.ontologySnapshot.upsert({
      where: { domainId_weekNumber: { domainId: domain.id, weekNumber: 0 } },
      update: {
        data: snapshotData,
        entityCount: fullEntities.length,
        relationCount: fullRelations.length,
        label: 'initial',
      },
      create: {
        domainId: domain.id,
        weekNumber: 0,
        label: 'initial',
        data: snapshotData,
        entityCount: fullEntities.length,
        relationCount: fullRelations.length,
      },
    });
  }

  console.log('Seed completed (user password from SEED_USER_PASSWORD, admin password from SEED_ADMIN_PASSWORD)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
