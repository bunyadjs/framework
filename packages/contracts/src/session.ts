/**
 * Session store contract.
 */
export interface SessionStore {
  read(id: string): Promise<Record<string, unknown> | undefined>;
  write(id: string, data: Record<string, unknown>): Promise<void>;
  destroy(id: string): Promise<void>;
}
