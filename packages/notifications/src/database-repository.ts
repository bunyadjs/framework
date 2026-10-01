export type DatabaseNotificationRecord = {
  id: string;
  type: string;
  notifiableType: string;
  notifiableId: string | number;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

/**
 * Persistence for the `database` notification channel.
 */
export interface DatabaseNotificationRepository {
  store(
    record: Omit<DatabaseNotificationRecord, "readAt" | "createdAt"> & {
      readAt?: string | null;
      createdAt?: string;
    },
  ): Promise<void>;
  forNotifiable(
    notifiableType: string,
    notifiableId: string | number,
  ): Promise<DatabaseNotificationRecord[]>;
  markAsRead(id: string): Promise<boolean>;
  unreadCount(
    notifiableType: string,
    notifiableId: string | number,
  ): Promise<number>;
}
