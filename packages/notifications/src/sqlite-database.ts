import type {
  DatabaseNotificationRecord,
  DatabaseNotificationRepository,
} from "./database-repository.ts";

export type DatabaseNotificationConnection = {
  /** Affected-row count is ignored; `Promise<number>` matches `@bunyad/database` Connection. */
  run(sql: string, params?: unknown[]): void | Promise<void> | Promise<number>;
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T | null | Promise<T | null>;
  all<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T[] | Promise<T[]>;
};

export type SqliteDatabaseNotificationRepositoryOptions = {
  connection: DatabaseNotificationConnection;
  table?: string;
};

type Row = {
  id: string;
  type: string;
  notifiable_type: string;
  notifiable_id: string | number;
  data: string;
  read_at: string | null;
  created_at: string;
};

/**
 * Database-backed notification inbox (`notifications` table).
 * Works with SQLite, PostgreSQL, and MySQL connections.
 */
export class SqliteDatabaseNotificationRepository
  implements DatabaseNotificationRepository
{
  readonly #db: DatabaseNotificationConnection;
  readonly #table: string;

  constructor(options: SqliteDatabaseNotificationRepositoryOptions) {
    this.#db = options.connection;
    this.#table = options.table ?? "notifications";
  }

  async store(
    record: Omit<DatabaseNotificationRecord, "readAt" | "createdAt"> & {
      readAt?: string | null;
      createdAt?: string;
    },
  ): Promise<void> {
    const now = record.createdAt ?? new Date().toISOString();
    await this.#db.run(
      `INSERT INTO ${this.#table}
        (id, type, notifiable_type, notifiable_id, data, read_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.type,
        record.notifiableType,
        record.notifiableId,
        JSON.stringify(record.data),
        record.readAt ?? null,
        now,
        now,
      ],
    );
  }

  async forNotifiable(
    notifiableType: string,
    notifiableId: string | number,
  ): Promise<DatabaseNotificationRecord[]> {
    const rows = await this.#db.all<Row>(
      `SELECT id, type, notifiable_type, notifiable_id, data, read_at, created_at
       FROM ${this.#table}
       WHERE notifiable_type = ? AND notifiable_id = ?
       ORDER BY created_at DESC`,
      [notifiableType, notifiableId],
    );
    return rows.map(mapRow);
  }

  async markAsRead(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const before = await this.#db.get<{ id: string }>(
      `SELECT id FROM ${this.#table} WHERE id = ?`,
      [id],
    );
    if (!before) return false;
    await this.#db.run(
      `UPDATE ${this.#table} SET read_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, id],
    );
    return true;
  }

  async unreadCount(
    notifiableType: string,
    notifiableId: string | number,
  ): Promise<number> {
    const row = await this.#db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM ${this.#table}
       WHERE notifiable_type = ? AND notifiable_id = ? AND read_at IS NULL`,
      [notifiableType, notifiableId],
    );
    return row?.c ?? 0;
  }
}

function mapRow(row: Row): DatabaseNotificationRecord {
  return {
    id: row.id,
    type: row.type,
    notifiableType: row.notifiable_type,
    notifiableId: row.notifiable_id,
    data: JSON.parse(row.data) as Record<string, unknown>,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}
