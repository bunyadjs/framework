import { expect } from "bun:test";
import { DB } from "@bunyad/database";

/**
 * Assert that at least one row matches the given column values.
 */
export async function assertDatabaseHas(
  table: string,
  data: Record<string, unknown>,
): Promise<void> {
  let query = DB.table(table);
  for (const [column, value] of Object.entries(data)) {
    query = query.where(column, value);
  }
  const count = await query.count();
  expect(count).toBeGreaterThan(0);
}

/**
 * Assert that no row matches the given column values.
 */
export async function assertDatabaseMissing(
  table: string,
  data: Record<string, unknown>,
): Promise<void> {
  let query = DB.table(table);
  for (const [column, value] of Object.entries(data)) {
    query = query.where(column, value);
  }
  const count = await query.count();
  expect(count).toBe(0);
}

/**
 * Assert the number of rows in a table (optionally filtered).
 */
export async function assertDatabaseCount(
  table: string,
  count: number,
  data: Record<string, unknown> = {},
): Promise<void> {
  let query = DB.table(table);
  for (const [column, value] of Object.entries(data)) {
    query = query.where(column, value);
  }
  expect(await query.count()).toBe(count);
}

type SoftDeletableModel = {
  trashed?: () => boolean;
  getTable?: () => string;
  getKey?: () => unknown;
  deleted_at?: unknown;
  id?: unknown;
};

type SoftDeleteModelClass = {
  getTable?: () => string;
  onlyTrashed?: () => {
    where: (col: string, val: unknown) => { first: () => Promise<unknown> };
  };
  withTrashed?: () => {
    where: (col: string, val: unknown) => { first: () => Promise<SoftDeletableModel | null> };
  };
  find?: (id: unknown) => Promise<SoftDeletableModel | null>;
};

/**
 * Assert a model is soft-deleted (`deleted_at` set / `trashed()`).
 */
export async function assertSoftDeleted(
  modelOrClass: SoftDeletableModel | SoftDeleteModelClass,
  id?: unknown,
): Promise<void> {
  if (id !== undefined) {
    const Model = modelOrClass as SoftDeleteModelClass;
    if (typeof Model.onlyTrashed === "function") {
      const row = await Model.onlyTrashed().where("id", id).first();
      expect(row).toBeTruthy();
      return;
    }
    const table = Model.getTable?.() ?? "unknown";
    let query = DB.table(table).where("id", id);
    query = query.whereNotNull("deleted_at");
    expect(await query.count()).toBeGreaterThan(0);
    return;
  }

  const model = modelOrClass as SoftDeletableModel;
  if (typeof model.trashed === "function") {
    expect(model.trashed()).toBe(true);
    return;
  }
  expect(model.deleted_at).toBeTruthy();
}

/** Assert a model row exists (not soft-deleted when SoftDeletes is used). */
export async function assertModelExists(
  Model: SoftDeleteModelClass,
  id: unknown,
): Promise<void> {
  if (typeof Model.withTrashed === "function") {
    const row = await Model.withTrashed().where("id", id).first();
    expect(row).toBeTruthy();
    if (row && typeof row.trashed === "function") {
      expect(row.trashed()).toBe(false);
    }
    return;
  }
  const row = await Model.find?.(id);
  expect(row).toBeTruthy();
}
