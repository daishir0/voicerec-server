import { prisma } from './db';

export interface EntityContext {
  entityId: string;
  prefLabel: string;
  altLabels: string[];
  definition: string | null;
  category: string | null;
  relations: Array<{
    type: string;
    targetLabel: string;
    weight: number;
  }>;
}

export async function getEntityContextFull(entityIds: string[]): Promise<EntityContext[]> {
  if (entityIds.length === 0) return [];

  const entities = await prisma.ontologyEntity.findMany({
    where: { id: { in: entityIds } },
    select: {
      id: true,
      prefLabel: true,
      altLabels: true,
      definition: true,
      category: true,
      relationsFrom: {
        select: {
          relationType: true,
          cooccurrenceWeight: true,
          toEntity: { select: { prefLabel: true } },
        },
      },
      relationsTo: {
        select: {
          relationType: true,
          cooccurrenceWeight: true,
          fromEntity: { select: { prefLabel: true } },
        },
      },
    },
  });

  return entities.map((e) => {
    const relationsFrom = e.relationsFrom.map((r) => ({
      type: r.relationType,
      targetLabel: r.toEntity.prefLabel,
      weight: r.cooccurrenceWeight,
    }));
    const relationsTo = e.relationsTo.map((r) => ({
      type: `inverse:${r.relationType}`,
      targetLabel: r.fromEntity.prefLabel,
      weight: r.cooccurrenceWeight,
    }));

    return {
      entityId: e.id,
      prefLabel: e.prefLabel,
      altLabels: JSON.parse(e.altLabels) as string[],
      definition: e.definition ?? null,
      category: e.category ?? null,
      relations: [...relationsFrom, ...relationsTo],
    };
  });
}

export async function getEntityContextFlat(entityIds: string[]): Promise<EntityContext[]> {
  if (entityIds.length === 0) return [];

  const entities = await prisma.ontologyEntity.findMany({
    where: { id: { in: entityIds } },
    select: {
      id: true,
      prefLabel: true,
      altLabels: true,
    },
  });

  return entities.map((e) => ({
    entityId: e.id,
    prefLabel: e.prefLabel,
    altLabels: JSON.parse(e.altLabels) as string[],
    definition: null,
    category: null,
    relations: [],
  }));
}
