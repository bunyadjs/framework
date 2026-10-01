import type { SessionStore } from "@bunyad/contracts";
import { Crypt } from "@bunyad/common";

/**
 * Encrypts the session bag with `APP_KEY` before write; decrypts on read.
 * Plain JSON payloads still load so existing file/DB rows migrate in place.
 */
export class EncryptedSessionStore implements SessionStore {
  constructor(private readonly store: SessionStore) {}

  async read(id: string): Promise<Record<string, unknown> | undefined> {
    const raw = await this.store.read(id);
    if (raw === undefined) return undefined;

    // Encrypted wrapper shape: { __bunyad_enc: "<payload>" }
    const enc = raw.__bunyad_enc;
    if (typeof enc === "string") {
      try {
        return JSON.parse(Crypt.decrypt(enc)) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }

    return raw;
  }

  async write(id: string, data: Record<string, unknown>): Promise<void> {
    const payload = Crypt.encrypt(JSON.stringify(data));
    await this.store.write(id, { __bunyad_enc: payload });
  }

  async destroy(id: string): Promise<void> {
    await this.store.destroy(id);
  }
}

/** Wrap a store when `APP_KEY` (or Crypt.setKey) is available. */
export function maybeEncryptSessionStore(store: SessionStore): SessionStore {
  try {
    Crypt.encrypt("probe");
    return new EncryptedSessionStore(store);
  } catch {
    return store;
  }
}
