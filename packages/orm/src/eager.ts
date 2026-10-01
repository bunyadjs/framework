/**
 * Eager-load relations and aggregates onto models.
 */
import { wrapSqlName } from "@bunyad/database";
import { OrmCollection } from "./orm-collection.ts";
import {
  softDeleteAliasSql,
  uniqueKeys,
  coerceEagerRelations,
  type EagerRelationConstraint,
  type NormalizedEagerRelation,
} from "./model-helpers.ts";
import { eagerFetchByKeys } from "./eager-fetch.ts";
import { Model, type ModelClass } from "./model.ts";
import type { ModelQuery } from "./model-query.ts";
import { enterEagerLoad, leaveEagerLoad } from "./model-strictness.ts";
import {
  BelongsTo,
  BelongsToMany,
  HasMany,
  HasManyThrough,
  HasOne,
  HasOneThrough,
  MorphMany,
  MorphOne,
  MorphTo,
  MorphToMany,
  aggregateRelation,
  applyPivotAttributes,
  resolveMorphType,
  resolveRelation,
} from "./relations.ts";

/** Eager-load named relations onto models (`with` / `load` / collections).
 * Batches BelongsTo / HasMany / HasOne / BelongsToMany / Morph* / ofMany with
 * `WHERE IN`. Nested paths like `parent.children` are supported.
 * Independent top-level relations load in parallel.
 * Constraints from `with({ posts: (q) => q.where(…) })` are applied per relation.
 */
/**
 * Eager-load relations onto models.
 * Returns void when all work is synchronous (SQLite BelongsTo fast-find),
 * otherwise a Promise — callers must branch like `get()` hydrate does.
 */
export function eagerLoadModels(
  models: Model[],
  relations: Array<string | NormalizedEagerRelation>,
): void | Promise<void> {
  const list = models;
  const entries = coerceEagerRelations(relations);
  if (entries.length === 0 || list.length === 0) return;

  enterEagerLoad();
  let asyncWork: void | Promise<void>;
  try {
    asyncWork = eagerLoadModelsBody(list, entries);
  } catch (err) {
    leaveEagerLoad();
    throw err;
  }
  if (asyncWork && typeof (asyncWork as Promise<void>).then === "function") {
    return (asyncWork as Promise<void>).finally(() => {
      leaveEagerLoad();
    });
  }
  leaveEagerLoad();
  return asyncWork;
}

type EagerGroup = {
  nested: NormalizedEagerRelation[];
  constraint?: EagerRelationConstraint;
};

function eagerLoadModelsBody(
  list: Model[],
  entries: NormalizedEagerRelation[],
): void | Promise<void> {
  const grouped = new Map<string, EagerGroup>();
  for (const entry of entries) {
    if (typeof entry.name !== "string" || !entry.name.trim()) continue;
    const [head, ...rest] = entry.name.split(".");
    if (!head) continue;
    let group = grouped.get(head);
    if (!group) {
      group = { nested: [] };
      grouped.set(head, group);
    }
    if (rest.length > 0) {
      group.nested.push({
        name: rest.join("."),
        constraint: entry.constraint,
      });
    } else if (entry.constraint) {
      group.constraint = entry.constraint;
    }
  }

  const pending: Promise<void>[] = [];
  for (const [relation, group] of grouped) {
    const result = eagerLoadOneRelation(list, relation, group.constraint);
    if (result) pending.push(result);
  }

  const finishNested = (): void | Promise<void> => {
    const nestedPending: Promise<void>[] = [];
    for (const [relation, group] of grouped) {
      if (group.nested.length === 0) continue;
      const children: Model[] = [];
      for (const model of list) {
        const value = (model as unknown as Record<string, unknown>)[relation];
        if (value == null) continue;
        if (value instanceof OrmCollection) {
          for (const child of value) children.push(child);
        } else if (Array.isArray(value)) {
          children.push(...(value as Model[]));
        } else if (typeof value === "object") {
          children.push(value as Model);
        }
      }
      if (children.length > 0) {
        const nestedResult = eagerLoadModels(children, group.nested);
        if (nestedResult) nestedPending.push(nestedResult);
      }
    }
    if (nestedPending.length === 0) return;
    return Promise.all(nestedPending).then(() => undefined);
  };

  if (pending.length === 0) return finishNested();
  return Promise.all(pending).then(() => finishNested());
}

function applyConstraint(
  q: ModelQuery,
  constraint?: EagerRelationConstraint,
): ModelQuery {
  if (constraint) constraint(q as never);
  return q;
}

function relationFromModel(model: Model, relation: string): unknown {
  try {
    return model.related(relation);
  } catch {
    return null;
  }
}

/** Keep `WHERE IN` under common driver bind limits. */
const EAGER_IN_CHUNK = 900;
/** Max concurrent IN-chunk queries (bulk eager / sync). Pages ≤900 ids stay single-query. */
const EAGER_IN_CONCURRENCY = 3;

async function forEachIdChunk(
  ids: unknown[],
  run: (chunk: unknown[]) => Promise<void>,
): Promise<void> {
  if (ids.length === 0) return;
  if (ids.length <= EAGER_IN_CHUNK) {
    await run(ids);
    return;
  }

  const chunks: unknown[][] = [];
  for (let i = 0; i < ids.length; i += EAGER_IN_CHUNK) {
    chunks.push(ids.slice(i, i + EAGER_IN_CHUNK));
  }

  // Bounded pool — avoids pool stampede when stacking on parallel with() relations.
  let next = 0;
  const workers = Array.from(
    { length: Math.min(EAGER_IN_CONCURRENCY, chunks.length) },
    async () => {
      while (next < chunks.length) {
        const index = next++;
        await run(chunks[index]!);
      }
    },
  );
  await Promise.all(workers);
}

function eagerLoadOneRelation(
  models: Model[],
  relation: string,
  constraint?: EagerRelationConstraint,
): void | Promise<void> {
  const sampleRel = relationFromModel(models[0]!, relation);
  if (!sampleRel) return;

  if (sampleRel instanceof HasOne && sampleRel.isOfMany()) {
    return eagerLoadHasOneOfMany(models, relation, sampleRel, constraint);
  }
  if (sampleRel instanceof MorphOne && sampleRel.isOfMany()) {
    return eagerLoadMorphOneOfMany(models, relation, sampleRel, constraint);
  }

  if (sampleRel instanceof BelongsTo) {
    return eagerLoadBelongsTo(models, relation, sampleRel, constraint);
  }
  if (sampleRel instanceof HasMany) {
    return eagerLoadHasMany(models, relation, sampleRel, constraint);
  }
  if (sampleRel instanceof HasOne) {
    return eagerLoadHasOne(models, relation, sampleRel, constraint);
  }
  if (sampleRel instanceof BelongsToMany) {
    return eagerLoadBelongsToMany(models, relation, sampleRel, constraint);
  }
  if (sampleRel instanceof MorphToMany) {
    return eagerLoadMorphToMany(models, relation, sampleRel, constraint);
  }
  if (sampleRel instanceof MorphMany) {
    return eagerLoadMorphMany(models, relation, sampleRel, constraint);
  }
  if (sampleRel instanceof MorphOne) {
    return eagerLoadMorphOne(models, relation, sampleRel, constraint);
  }
  if (sampleRel instanceof MorphTo) {
    return eagerLoadMorphTo(models, relation, sampleRel, constraint);
  }
  if (sampleRel instanceof HasManyThrough) {
    return eagerLoadHasManyThrough(models, relation, sampleRel, constraint);
  }
  if (sampleRel instanceof HasOneThrough) {
    return eagerLoadHasOneThrough(models, relation, sampleRel, constraint);
  }
}

/** Single-query ofMany via GROUP BY join (avoids per-row correlated subqueries). */
async function eagerLoadHasOneOfMany(
  models: Model[],
  relation: string,
  sample: HasOne,
  constraint?: EagerRelationConstraint,
): Promise<void> {
  const foreignKey = sample.getForeignKeyName();
  const localKey = sample.getLocalKeyName();
  const Related = sample.getRelated();
  const ofManyColumn = sample.getOfManyColumn()!;
  const ofManyAggregate = sample.getOfManyAggregate()!;
  const parentIds = uniqueKeys(
    models.map(
      (model) => (model as unknown as Record<string, unknown>)[localKey],
    ),
  );
  const byParent = new Map<string, Model>();
  if (parentIds.length > 0 && constraint) {
    await forEachIdChunk(parentIds, async (chunk) => {
      let q = Related.whereIn(foreignKey, chunk);
      applyConstraint(q, constraint);
      const related = await q.get();
      const pick =
        ofManyAggregate === "max"
          ? (a: unknown, b: unknown) => ((a as never) > (b as never) ? a : b)
          : (a: unknown, b: unknown) => ((a as never) < (b as never) ? a : b);
      const best = new Map<string, { value: unknown; model: Model }>();
      for (const row of related.all()) {
        const key = String(
          (row as unknown as Record<string, unknown>)[foreignKey],
        );
        const value = (row as unknown as Record<string, unknown>)[ofManyColumn];
        const prev = best.get(key);
        if (!prev || pick(value, prev.value) === value) {
          best.set(key, { value, model: row });
        }
      }
      for (const [key, entry] of best) {
        if (!byParent.has(key)) byParent.set(key, entry.model);
      }
    });
  } else if (parentIds.length > 0) {
    const dialect = Related.getConnection().dialect;
    const table = wrapSqlName(dialect, Related.table);
    const col = wrapSqlName(dialect, ofManyColumn);
    const fk = wrapSqlName(dialect, foreignKey);
    const agg = ofManyAggregate.toUpperCase();
    const softOuter = softDeleteAliasSql(Related, table);
    const softSub = softDeleteAliasSql(Related, "bunyad_of_many");
    await forEachIdChunk(parentIds, async (chunk) => {
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = await Related.getConnection().all<Record<string, unknown>>(
        `SELECT ${table}.*
         FROM ${table}
         INNER JOIN (
           SELECT bunyad_of_many.${fk} AS __bunyad_fk, ${agg}(bunyad_of_many.${col}) AS __bunyad_agg
           FROM ${table} AS bunyad_of_many
           WHERE bunyad_of_many.${fk} IN (${placeholders})${softSub}
           GROUP BY bunyad_of_many.${fk}
         ) AS bunyad_agg
           ON ${table}.${fk} = bunyad_agg.__bunyad_fk
          AND ${table}.${col} = bunyad_agg.__bunyad_agg
         WHERE ${table}.${fk} IN (${placeholders})${softOuter}`,
        [...chunk, ...chunk],
      );
      for (const row of rows) {
        const key = String(row[foreignKey]);
        if (!byParent.has(key)) byParent.set(key, new Related(row));
      }
    });
  }
  for (const model of models) {
    const id = (model as unknown as Record<string, unknown>)[localKey];
        (model as unknown as Record<string, unknown>)[relation] =
      id == null ? null : (byParent.get(String(id)) ?? null);
  }
}

async function eagerLoadMorphOneOfMany(
  models: Model[],
  relation: string,
  sample: MorphOne,
  constraint?: EagerRelationConstraint,
): Promise<void> {
  const Related = sample.getRelated();
  const typeColumn = sample.getTypeColumn();
  const idColumn = sample.getIdColumn();
  const morphType = sample.getMorphType();
  const localKey = sample.getLocalKeyName();
  const ofManyColumn = sample.getOfManyColumn()!;
  const ofManyAggregate = sample.getOfManyAggregate()!;
  const parentIds = uniqueKeys(
    models.map(
      (model) => (model as unknown as Record<string, unknown>)[localKey],
    ),
  );
  const byParent = new Map<string, Model>();
  if (parentIds.length > 0 && constraint) {
    await forEachIdChunk(parentIds, async (chunk) => {
      let q = Related.where(typeColumn, morphType).whereIn(idColumn, chunk);
      applyConstraint(q, constraint);
      const related = await q.get();
      const pick =
        ofManyAggregate === "max"
          ? (a: unknown, b: unknown) => ((a as never) > (b as never) ? a : b)
          : (a: unknown, b: unknown) => ((a as never) < (b as never) ? a : b);
      const best = new Map<string, { value: unknown; model: Model }>();
      for (const row of related.all()) {
        const key = String(
          (row as unknown as Record<string, unknown>)[idColumn],
        );
        const value = (row as unknown as Record<string, unknown>)[ofManyColumn];
        const prev = best.get(key);
        if (!prev || pick(value, prev.value) === value) {
          best.set(key, { value, model: row });
        }
      }
      for (const [key, entry] of best) {
        if (!byParent.has(key)) byParent.set(key, entry.model);
      }
    });
  } else if (parentIds.length > 0) {
    const dialect = Related.getConnection().dialect;
    const table = wrapSqlName(dialect, Related.table);
    const col = wrapSqlName(dialect, ofManyColumn);
    const typeCol = wrapSqlName(dialect, typeColumn);
    const idCol = wrapSqlName(dialect, idColumn);
    const agg = ofManyAggregate.toUpperCase();
    const softOuter = softDeleteAliasSql(Related, table);
    const softSub = softDeleteAliasSql(Related, "bunyad_of_many");
    await forEachIdChunk(parentIds, async (chunk) => {
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = await Related.getConnection().all<Record<string, unknown>>(
        `SELECT ${table}.*
         FROM ${table}
         INNER JOIN (
           SELECT bunyad_of_many.${idCol} AS __bunyad_fk, ${agg}(bunyad_of_many.${col}) AS __bunyad_agg
           FROM ${table} AS bunyad_of_many
           WHERE bunyad_of_many.${typeCol} = ?
             AND bunyad_of_many.${idCol} IN (${placeholders})${softSub}
           GROUP BY bunyad_of_many.${idCol}
         ) AS bunyad_agg
           ON ${table}.${idCol} = bunyad_agg.__bunyad_fk
          AND ${table}.${col} = bunyad_agg.__bunyad_agg
         WHERE ${table}.${typeCol} = ?
           AND ${table}.${idCol} IN (${placeholders})${softOuter}`,
        [morphType, ...chunk, morphType, ...chunk],
      );
      for (const row of rows) {
        const key = String(row[idColumn]);
        if (!byParent.has(key)) byParent.set(key, new Related(row));
      }
    });
  }
  for (const model of models) {
    const id = (model as unknown as Record<string, unknown>)[localKey];
        (model as unknown as Record<string, unknown>)[relation] =
      id == null ? null : (byParent.get(String(id)) ?? null);
  }
}

function eagerLoadBelongsTo(
  models: Model[],
  relation: string,
  sample: BelongsTo,
  constraint?: EagerRelationConstraint,
): void | Promise<void> {
  const foreignKey = sample.getForeignKeyName();
  const ownerKey = sample.getOwnerKeyName();
  const Related = sample.getRelated();
  const ids = uniqueKeys(
    models.map(
      (model) => (model as unknown as Record<string, unknown>)[foreignKey],
    ),
  );
  if (ids.length === 0) {
    for (const model of models) {
      (model as unknown as Record<string, unknown>)[relation] = null;
    }
    return;
  }
  const byOwner = new Map<string, Model>();
  return (async () => {
    await forEachIdChunk(ids, async (chunk) => {
      let related: Model[];
      if (constraint) {
        let q = Related.whereIn(ownerKey, chunk);
        applyConstraint(q, constraint);
        related = (await q.get()).all();
      } else {
        related = await eagerFetchByKeys(Related, ownerKey, chunk);
      }
      for (const row of related) {
        byOwner.set(
          String((row as unknown as Record<string, unknown>)[ownerKey]),
          row,
        );
      }
    });
    for (const model of models) {
      const id = (model as unknown as Record<string, unknown>)[foreignKey];
      (model as unknown as Record<string, unknown>)[relation] =
        id == null ? null : (byOwner.get(String(id)) ?? null);
    }
  })();
}

async function eagerLoadHasMany(
  models: Model[],
  relation: string,
  sample: HasMany,
  constraint?: EagerRelationConstraint,
): Promise<void> {
  const foreignKey = sample.getForeignKeyName();
  const localKey = sample.getLocalKeyName();
  const Related = sample.getRelated();
  const parentIds = uniqueKeys(
    models.map(
      (model) => (model as unknown as Record<string, unknown>)[localKey],
    ),
  );
  const byParent = new Map<string, Model[]>();
  await forEachIdChunk(parentIds, async (chunk) => {
    let related: Model[];
    if (constraint) {
      let q = Related.whereIn(foreignKey, chunk);
      applyConstraint(q, constraint);
      related = (await q.get()).all();
    } else {
      related = await eagerFetchByKeys(Related, foreignKey, chunk);
    }
    for (const row of related) {
      const key = String(
        (row as unknown as Record<string, unknown>)[foreignKey],
      );
      const list = byParent.get(key) ?? [];
      list.push(row);
      byParent.set(key, list);
    }
  });
  for (const model of models) {
    const id = (model as unknown as Record<string, unknown>)[localKey];
    (model as unknown as Record<string, unknown>)[relation] = new OrmCollection(
      id == null ? [] : (byParent.get(String(id)) ?? []),
      { owned: true },
    );
  }
}

async function eagerLoadHasOne(
  models: Model[],
  relation: string,
  sample: HasOne,
  constraint?: EagerRelationConstraint,
): Promise<void> {
  const foreignKey = sample.getForeignKeyName();
  const localKey = sample.getLocalKeyName();
  const Related = sample.getRelated();
  const parentIds = uniqueKeys(
    models.map(
      (model) => (model as unknown as Record<string, unknown>)[localKey],
    ),
  );
  const byParent = new Map<string, Model>();
  await forEachIdChunk(parentIds, async (chunk) => {
    let related: Model[];
    if (constraint) {
      let q = Related.whereIn(foreignKey, chunk);
      applyConstraint(q, constraint);
      related = (await q.get()).all();
    } else {
      related = await eagerFetchByKeys(Related, foreignKey, chunk);
    }
    for (const row of related) {
      const key = String(
        (row as unknown as Record<string, unknown>)[foreignKey],
      );
      if (!byParent.has(key)) byParent.set(key, row);
    }
  });
  for (const model of models) {
    const id = (model as unknown as Record<string, unknown>)[localKey];
    (model as unknown as Record<string, unknown>)[relation] =
      id == null ? null : (byParent.get(String(id)) ?? null);
  }
}


async function eagerLoadHasManyThrough(
  models: Model[],
  relation: string,
  sample: HasManyThrough,
  constraint?: EagerRelationConstraint,
): Promise<void> {
  const Through = sample.getThrough();
  const Related = sample.getRelated();
  const firstKey = sample.getFirstKeyName();
  const secondKey = sample.getSecondKeyName();
  const localKey = sample.getLocalKeyName();
  const secondLocalKey = sample.getSecondLocalKeyName();
  const parentIds = uniqueKeys(
    models.map(
      (model) => (model as unknown as Record<string, unknown>)[localKey],
    ),
  );

  const throughByParent = new Map<string, unknown[]>();
  const throughIdToParent = new Map<string, string>();
  await forEachIdChunk(parentIds, async (chunk) => {
    const throughRows = await eagerFetchByKeys(Through, firstKey, chunk);
    for (const row of throughRows) {
      const rec = row as unknown as Record<string, unknown>;
      const parentKey = String(rec[firstKey]);
      const throughId = rec[secondLocalKey];
      if (throughId == null) continue;
      const list = throughByParent.get(parentKey) ?? [];
      list.push(throughId);
      throughByParent.set(parentKey, list);
      throughIdToParent.set(String(throughId), parentKey);
    }
  });

  const throughIds = uniqueKeys([...throughIdToParent.keys()]);
  const byParent = new Map<string, Model[]>();
  await forEachIdChunk(throughIds, async (chunk) => {
    let relatedRows: Model[];
    if (constraint) {
      let q = Related.whereIn(secondKey, chunk);
      applyConstraint(q, constraint);
      relatedRows = (await q.get()).all();
    } else {
      relatedRows = await eagerFetchByKeys(Related, secondKey, chunk);
    }
    for (const row of relatedRows) {
      const throughFk = (row as unknown as Record<string, unknown>)[secondKey];
      if (throughFk == null) continue;
      const parentKey = throughIdToParent.get(String(throughFk));
      if (parentKey == null) continue;
      const list = byParent.get(parentKey) ?? [];
      list.push(row);
      byParent.set(parentKey, list);
    }
  });

  for (const model of models) {
    const id = (model as unknown as Record<string, unknown>)[localKey];
    (model as unknown as Record<string, unknown>)[relation] = new OrmCollection(
      id == null ? [] : (byParent.get(String(id)) ?? []),
      { owned: true },
    );
  }
}

async function eagerLoadHasOneThrough(
  models: Model[],
  relation: string,
  sample: HasOneThrough,
  constraint?: EagerRelationConstraint,
): Promise<void> {
  await eagerLoadHasManyThrough(
    models,
    relation,
    sample.asHasManyThrough(),
    constraint,
  );
  for (const model of models) {
    const collection = (model as unknown as Record<string, unknown>)[
      relation
    ] as { first?: () => Model | null; all?: () => Model[] } | null;
    if (collection && typeof collection.first === "function") {
      (model as unknown as Record<string, unknown>)[relation] =
        collection.first() ?? null;
    }
  }
}

async function eagerLoadBelongsToMany(
  models: Model[],
  relation: string,
  sample: BelongsToMany,
  constraint?: EagerRelationConstraint,
): Promise<void> {
  const Related = sample.getRelated();
  const parent = models[0]!.constructor as ModelClass;
  const parentKey = parent.primaryKey;
  const pivotTable = sample.getPivotTable();
  const foreignPivotKey = sample.getForeignPivotKeyName();
  const relatedPivotKey = sample.getRelatedPivotKeyName();
  const pivotColumns = sample.getPivotColumns();
  const pivotKeys =
    pivotColumns.length > 0
      ? [foreignPivotKey, relatedPivotKey, ...pivotColumns.filter(
          (c) => c !== foreignPivotKey && c !== relatedPivotKey,
        )]
      : [];
  const parentIds = uniqueKeys(
    models.map(
      (model) => (model as unknown as Record<string, unknown>)[parentKey],
    ),
  );
  const byParent = new Map<string, Model[]>();
  if (parentIds.length > 0) {
    const dialect = parent.getConnection().dialect;
    const qRelated = wrapSqlName(dialect, Related.table);
    const qPivot = wrapSqlName(dialect, pivotTable);
    const qRelatedPk = wrapSqlName(dialect, Related.primaryKey);
    const qForeignPivot = wrapSqlName(dialect, foreignPivotKey);
    const qRelatedPivot = wrapSqlName(dialect, relatedPivotKey);
    const soft = softDeleteAliasSql(Related, qRelated);
    const pivotSelect =
      pivotKeys.length > 0
        ? `, ${pivotKeys
            .map(
              (col) =>
                `${qPivot}.${wrapSqlName(dialect, col)} AS __pivot_${col}`,
            )
            .join(", ")}`
        : "";
    await forEachIdChunk(parentIds, async (chunk) => {
      if (constraint) {
        let q = Related.newQuery()
          .join(
            pivotTable,
            `${pivotTable}.${relatedPivotKey}`,
            "=",
            `${Related.table}.${Related.primaryKey}`,
          )
          .whereIn(`${pivotTable}.${foreignPivotKey}`, chunk)
          .select(`${Related.table}.*`)
          .selectRaw(
            `${pivotTable}.${foreignPivotKey} as __bunyad_parent_id`,
          );
        for (const col of pivotKeys) {
          q = q.selectRaw(`${pivotTable}.${col} as __pivot_${col}`);
        }
        applyConstraint(q, constraint);
        const related = await q.get();
        for (const row of related.all()) {
          const rec = row as unknown as Record<string, unknown>;
          const parentId = rec.__bunyad_parent_id;
          delete rec.__bunyad_parent_id;
          applyPivotAttributes(row, rec, pivotKeys);
          const key = String(parentId);
          const list = byParent.get(key) ?? [];
          list.push(row);
          byParent.set(key, list);
        }
        return;
      }
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = await parent.getConnection().all<Record<string, unknown>>(
        `SELECT ${qRelated}.*, ${qPivot}.${qForeignPivot} AS __bunyad_parent_id${pivotSelect}
         FROM ${qRelated}
         INNER JOIN ${qPivot}
           ON ${qPivot}.${qRelatedPivot} = ${qRelated}.${qRelatedPk}
         WHERE ${qPivot}.${qForeignPivot} IN (${placeholders})${soft}`,
        chunk,
      );
      for (const row of rows) {
        const parentId = row.__bunyad_parent_id;
        const { __bunyad_parent_id: _, ...attrs } = row;
        const model = new Related(attrs);
        model.exists = true;
        applyPivotAttributes(model, attrs, pivotKeys);
        const key = String(parentId);
        const list = byParent.get(key) ?? [];
        list.push(model);
        byParent.set(key, list);
      }
    });
  }
  for (const model of models) {
    const id = (model as unknown as Record<string, unknown>)[parentKey];
    (model as unknown as Record<string, unknown>)[relation] = new OrmCollection(
      id == null ? [] : (byParent.get(String(id)) ?? []),
      { owned: true },
    );
  }
}

async function eagerLoadMorphToMany(
  models: Model[],
  relation: string,
  sample: MorphToMany,
  constraint?: EagerRelationConstraint,
): Promise<void> {
  const Related = sample.getRelated();
  const parent = models[0]!.constructor as ModelClass;
  const parentKey = parent.primaryKey;
  const pivotTable = sample.getPivotTable();
  const foreignPivotKey = sample.getForeignPivotKeyName();
  const relatedPivotKey = sample.getRelatedPivotKeyName();
  const morphTypeColumn = sample.getMorphTypeColumn();
  const morphTypes = sample.getMorphTypes();
  const pivotTenantKey = sample.getPivotTenantKey();
  const parentTenantKey = sample.getParentTenantKey();
  const parentIds = uniqueKeys(
    models.map(
      (model) => (model as unknown as Record<string, unknown>)[parentKey],
    ),
  );
  const byParent = new Map<string, Model[]>();
  if (parentIds.length > 0 && morphTypes.length > 0) {
    const dialect = parent.getConnection().dialect;
    const qRelated = wrapSqlName(dialect, Related.table);
    const qPivot = wrapSqlName(dialect, pivotTable);
    const qRelatedPk = wrapSqlName(dialect, Related.primaryKey);
    const qForeignPivot = wrapSqlName(dialect, foreignPivotKey);
    const qRelatedPivot = wrapSqlName(dialect, relatedPivotKey);
    const qMorphType = wrapSqlName(dialect, morphTypeColumn);
    const soft = softDeleteAliasSql(Related, qRelated);
    const morphPlaceholders = morphTypes.map(() => "?").join(", ");
    await forEachIdChunk(parentIds, async (chunk) => {
      if (constraint) {
        let q = Related.newQuery()
          .join(
            pivotTable,
            `${pivotTable}.${relatedPivotKey}`,
            "=",
            `${Related.table}.${Related.primaryKey}`,
          )
          .whereIn(`${pivotTable}.${foreignPivotKey}`, chunk)
          .whereIn(`${pivotTable}.${morphTypeColumn}`, morphTypes)
          .select(`${Related.table}.*`)
          .selectRaw(
            `${pivotTable}.${foreignPivotKey} as __bunyad_parent_id`,
          );
        if (pivotTenantKey && parentTenantKey) {
          const tenantIds = uniqueKeys(
            models.map(
              (model) =>
                (model as unknown as Record<string, unknown>)[parentTenantKey],
            ),
          );
          if (tenantIds.length > 0) {
            q = q.whereIn(`${pivotTable}.${pivotTenantKey}`, tenantIds);
          }
        }
        applyConstraint(q, constraint);
        const related = await q.get();
        for (const row of related.all()) {
          const rec = row as unknown as Record<string, unknown>;
          const parentId = rec.__bunyad_parent_id;
          delete rec.__bunyad_parent_id;
          const key = String(parentId);
          const list = byParent.get(key) ?? [];
          list.push(row);
          byParent.set(key, list);
        }
        return;
      }
      const idPlaceholders = chunk.map(() => "?").join(", ");
      const params: unknown[] = [...chunk, ...morphTypes];
      let tenantSql = "";
      if (pivotTenantKey && parentTenantKey) {
        const tenantIds = uniqueKeys(
          models.map(
            (model) =>
              (model as unknown as Record<string, unknown>)[parentTenantKey],
          ),
        );
        if (tenantIds.length > 0) {
          const qTenant = wrapSqlName(dialect, pivotTenantKey);
          tenantSql = ` AND ${qPivot}.${qTenant} IN (${tenantIds.map(() => "?").join(", ")})`;
          params.push(...tenantIds);
        }
      }
      const rows = await parent.getConnection().all<Record<string, unknown>>(
        `SELECT ${qRelated}.*, ${qPivot}.${qForeignPivot} AS __bunyad_parent_id
         FROM ${qRelated}
         INNER JOIN ${qPivot}
           ON ${qPivot}.${qRelatedPivot} = ${qRelated}.${qRelatedPk}
         WHERE ${qPivot}.${qForeignPivot} IN (${idPlaceholders})
           AND ${qPivot}.${qMorphType} IN (${morphPlaceholders})${tenantSql}${soft}`,
        params,
      );
      for (const row of rows) {
        const parentId = row.__bunyad_parent_id;
        const { __bunyad_parent_id: _, ...attrs } = row;
        const key = String(parentId);
        const list = byParent.get(key) ?? [];
        list.push(new Related(attrs));
        byParent.set(key, list);
      }
    });
  }
  for (const model of models) {
    const id = (model as unknown as Record<string, unknown>)[parentKey];
    (model as unknown as Record<string, unknown>)[relation] = new OrmCollection(
      id == null ? [] : (byParent.get(String(id)) ?? []),
      { owned: true },
    );
  }
}

async function eagerLoadMorphMany(
  models: Model[],
  relation: string,
  sample: MorphMany,
  constraint?: EagerRelationConstraint,
): Promise<void> {
  const Related = sample.getRelated();
  const typeColumn = sample.getTypeColumn();
  const idColumn = sample.getIdColumn();
  const morphType = sample.getMorphType();
  const localKey = sample.getLocalKeyName();
  const parentIds = uniqueKeys(
    models.map(
      (model) => (model as unknown as Record<string, unknown>)[localKey],
    ),
  );
  const byParent = new Map<string, Model[]>();
  await forEachIdChunk(parentIds, async (chunk) => {
    let q = Related.where(typeColumn, morphType).whereIn(idColumn, chunk);
    applyConstraint(q, constraint);
    const related = await q.get();
    for (const row of related.all()) {
      const key = String(
        (row as unknown as Record<string, unknown>)[idColumn],
      );
      const list = byParent.get(key) ?? [];
      list.push(row);
      byParent.set(key, list);
    }
  });
  for (const model of models) {
    const id = (model as unknown as Record<string, unknown>)[localKey];
    (model as unknown as Record<string, unknown>)[relation] = new OrmCollection(
      id == null ? [] : (byParent.get(String(id)) ?? []),
      { owned: true },
    );
  }
}

async function eagerLoadMorphOne(
  models: Model[],
  relation: string,
  sample: MorphOne,
  constraint?: EagerRelationConstraint,
): Promise<void> {
  const Related = sample.getRelated();
  const typeColumn = sample.getTypeColumn();
  const idColumn = sample.getIdColumn();
  const morphType = sample.getMorphType();
  const localKey = sample.getLocalKeyName();
  const parentIds = uniqueKeys(
    models.map(
      (model) => (model as unknown as Record<string, unknown>)[localKey],
    ),
  );
  const byParent = new Map<string, Model>();
  await forEachIdChunk(parentIds, async (chunk) => {
    let q = Related.where(typeColumn, morphType).whereIn(idColumn, chunk);
    applyConstraint(q, constraint);
    const related = await q.get();
    for (const row of related.all()) {
      const key = String(
        (row as unknown as Record<string, unknown>)[idColumn],
      );
      if (!byParent.has(key)) byParent.set(key, row);
    }
  });
  for (const model of models) {
    const id = (model as unknown as Record<string, unknown>)[localKey];
    (model as unknown as Record<string, unknown>)[relation] =
      id == null ? null : (byParent.get(String(id)) ?? null);
  }
}

async function eagerLoadMorphTo(
  models: Model[],
  relation: string,
  sample: MorphTo,
  constraint?: EagerRelationConstraint,
): Promise<void> {
  const typeColumn = sample.getTypeColumn();
  const idColumn = sample.getIdColumn();
  const ownerKey = sample.getOwnerKeyName();
  const byType = new Map<string, unknown[]>();
  for (const model of models) {
    const row = model as unknown as Record<string, unknown>;
    const type = row[typeColumn];
    const id = row[idColumn];
    if (type == null || id == null) continue;
    const list = byType.get(String(type)) ?? [];
    list.push(id);
    byType.set(String(type), list);
  }

  const loaded = new Map<string, Model>();
  await Promise.all(
    [...byType.entries()].map(async ([type, ids]) => {
      const Related = resolveMorphType(type);
      const key = ownerKey ?? Related.primaryKey;
      await forEachIdChunk(uniqueKeys(ids), async (chunk) => {
        let q = Related.whereIn(key, chunk);
        applyConstraint(q, constraint);
        const related = await q.get();
        for (const row of related.all()) {
          loaded.set(
            `${type}:${String((row as unknown as Record<string, unknown>)[key])}`,
            row,
          );
        }
      });
    }),
  );

  for (const model of models) {
    const row = model as unknown as Record<string, unknown>;
    const type = row[typeColumn];
    const id = row[idColumn];
    row[relation] =
      type == null || id == null
        ? null
        : (loaded.get(`${String(type)}:${String(id)}`) ?? null);
  }
}

type AggregateFn = "count" | "sum" | "avg" | "min" | "max" | "exists";

export type EagerAggregateSpec = {
  relation: string;
  alias: string;
  fn: AggregateFn;
  column?: string;
};

/** Batch `loadCount` / `loadSum` / … onto many models (one GROUP BY query per relation). */
export async function eagerLoadAggregates(
  models: Model[],
  specs: EagerAggregateSpec[],
): Promise<void> {
  const list = models;
  if (list.length === 0 || specs.length === 0) return;
  const Parent = list[0]!.constructor as ModelClass;
  await Promise.all(
    specs.map((spec) => eagerLoadOneAggregate(list, Parent, spec)),
  );
}

function aggregateDefault(fn: AggregateFn): unknown {
  if (fn === "exists" || fn === "count" || fn === "sum") return 0;
  return null;
}

async function eagerLoadOneAggregate(
  models: Model[],
  Parent: ModelClass,
  spec: EagerAggregateSpec,
): Promise<void> {
  const meta = resolveRelation(Parent, spec.relation);
  if (!meta) {
    for (const model of models) {
      const value = await aggregateRelation(
        model,
        spec.relation,
        spec.fn,
        spec.column,
      );
      (model as unknown as Record<string, unknown>)[spec.alias] = value;
    }
    return;
  }

  const defaults = aggregateDefault(spec.fn);
  for (const model of models) {
    (model as unknown as Record<string, unknown>)[spec.alias] = defaults;
  }

  if (meta.kind === "has") {
    const parentIds = uniqueKeys(
      models.map(
        (model) =>
          (model as unknown as Record<string, unknown>)[meta.localKey],
      ),
    );
    if (parentIds.length === 0) return;
    const dialect = meta.related.getConnection().dialect;
    const fk = wrapSqlName(dialect, meta.foreignKey);
    let q = meta.related.whereIn(meta.foreignKey, parentIds).selectRaw(
      `${fk} as __bunyad_k`,
    );
    if (spec.fn === "exists") {
      q = q.selectRaw("1 as __bunyad_v");
    } else if (spec.fn === "count") {
      q = q.selectRaw("COUNT(*) as __bunyad_v");
    } else {
      const col = wrapSqlName(dialect, spec.column!);
      q = q.selectRaw(`${spec.fn.toUpperCase()}(${col}) as __bunyad_v`);
    }
    const rows = await q.groupBy(meta.foreignKey).toBase().getRows();
    const byParent = new Map<string, unknown>();
    for (const row of rows) {
      byParent.set(String(row.__bunyad_k), row.__bunyad_v);
    }
    for (const model of models) {
      const id = (model as unknown as Record<string, unknown>)[meta.localKey];
      if (id == null) continue;
      const value = byParent.get(String(id));
      if (value !== undefined) {
        (model as unknown as Record<string, unknown>)[spec.alias] = value;
      }
    }
    return;
  }

  if (meta.kind === "belongsTo") {
    const fks = uniqueKeys(
      models.map(
        (model) =>
          (model as unknown as Record<string, unknown>)[meta.foreignKey],
      ),
    );
    if (fks.length === 0) return;
    const dialect = meta.related.getConnection().dialect;
    const owner = wrapSqlName(dialect, meta.ownerKey);
    let q = meta.related.whereIn(meta.ownerKey, fks).selectRaw(
      `${owner} as __bunyad_k`,
    );
    if (spec.fn === "exists") {
      q = q.selectRaw("1 as __bunyad_v");
    } else if (spec.fn === "count") {
      q = q.selectRaw("COUNT(*) as __bunyad_v");
    } else {
      const col = wrapSqlName(dialect, spec.column!);
      q = q.selectRaw(`${spec.fn.toUpperCase()}(${col}) as __bunyad_v`);
    }
    const rows = await q.groupBy(meta.ownerKey).toBase().getRows();
    const byOwner = new Map<string, unknown>();
    for (const row of rows) {
      byOwner.set(String(row.__bunyad_k), row.__bunyad_v);
    }
    for (const model of models) {
      const fk = (model as unknown as Record<string, unknown>)[meta.foreignKey];
      if (fk == null) continue;
      const value = byOwner.get(String(fk));
      if (value !== undefined) {
        (model as unknown as Record<string, unknown>)[spec.alias] = value;
      }
    }
    return;
  }

  if (meta.kind === "hasManyThrough" || meta.kind === "hasOneThrough") return;

  const parentIds = uniqueKeys(
    models.map(
      (model) =>
        (model as unknown as Record<string, unknown>)[Parent.primaryKey],
    ),
  );
  if (parentIds.length === 0) return;
  const dialect = Parent.getConnection().dialect;
  const qRelated = wrapSqlName(dialect, meta.related.table);
  const qPivot = wrapSqlName(dialect, meta.pivotTable);
  const qRelatedPk = wrapSqlName(dialect, meta.related.primaryKey);
  const qForeignPivot = wrapSqlName(dialect, meta.foreignPivotKey);
  const qRelatedPivot = wrapSqlName(dialect, meta.relatedPivotKey);
  const soft = softDeleteAliasSql(meta.related, qRelated);
  const byParent = new Map<string, unknown>();
  await forEachIdChunk(parentIds, async (chunk) => {
    const placeholders = chunk.map(() => "?").join(", ");
    let selectV: string;
    if (spec.fn === "exists") {
      selectV = "1";
    } else if (spec.fn === "count") {
      selectV = "COUNT(*)";
    } else {
      selectV = `${spec.fn.toUpperCase()}(${wrapSqlName(dialect, spec.column!)})`;
    }
    const rows = await Parent.getConnection().all<Record<string, unknown>>(
      `SELECT ${qPivot}.${qForeignPivot} AS __bunyad_k, ${selectV} AS __bunyad_v
       FROM ${qRelated}
       INNER JOIN ${qPivot}
         ON ${qPivot}.${qRelatedPivot} = ${qRelated}.${qRelatedPk}
       WHERE ${qPivot}.${qForeignPivot} IN (${placeholders})${soft}
       GROUP BY ${qPivot}.${qForeignPivot}`,
      chunk,
    );
    for (const row of rows) {
      byParent.set(String(row.__bunyad_k), row.__bunyad_v);
    }
  });
  for (const model of models) {
    const id = (model as unknown as Record<string, unknown>)[Parent.primaryKey];
    if (id == null) continue;
    const value = byParent.get(String(id));
    if (value !== undefined) {
      (model as unknown as Record<string, unknown>)[spec.alias] = value;
    }
  }
}
