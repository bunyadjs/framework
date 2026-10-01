import type {
  DatabaseNotificationRecord,
  DatabaseNotificationRepository,
} from "./database-repository.ts";

/**
 * In-memory database notifications (tests).
 */
export class MemoryDatabaseNotificationRepository
  implements DatabaseNotificationRepository
{
  readonly #rows: DatabaseNotificationRecord[] = [];

  async store(
    record: Omit<DatabaseNotificationRecord, "readAt" | "createdAt"> & {
      readAt?: string | null;
      createdAt?: string;
    },
  ): Promise<void> {
    this.#rows.push({
      id: record.id,
      type: record.type,
      notifiableType: record.notifiableType,
      notifiableId: record.notifiableId,
      data: record.data,
      readAt: record.readAt ?? null,
      createdAt: record.createdAt ?? new Date().toISOString(),
    });
  }

  async forNotifiable(
    notifiableType: string,
    notifiableId: string | number,
  ): Promise<DatabaseNotificationRecord[]> {
    return this.#rows
      .filter(
        (r) =>
          r.notifiableType === notifiableType &&
          String(r.notifiableId) === String(notifiableId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async markAsRead(id: string): Promise<boolean> {
    const row = this.#rows.find((r) => r.id === id);
    if (!row) return false;
    row.readAt = new Date().toISOString();
    return true;
  }

  async unreadCount(
    notifiableType: string,
    notifiableId: string | number,
  ): Promise<number> {
    const rows = await this.forNotifiable(notifiableType, notifiableId);
    return rows.filter((r) => r.readAt == null).length;
  }
}
