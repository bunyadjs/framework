import { AsyncLocalStorage } from "node:async_hooks";
import { hashAccess, parseAccess } from "./access.ts";
import { type Bitmap, bitmapFromBase64, bitmapToBase64, emptyBitmap, orInto } from "./bitmap.ts";
import type { PermissionRegistry } from "./registry.ts";
import type { ScopeTree } from "./scope.ts";
import type { ColdLoad, PermissionStore } from "./store.ts";
import { GRANT_PERMISSION, GRANT_ROLE, type SharedCache, type Subject, type VersionStore } from "./types.ts";

/** Everything a subject may do in one scope. */
export type EffectiveSet = {
  bits: Bitmap;
  roleNames: Set<string>;
  /** [registry, subject, ...chain scopes] counters the entry was computed under. */
  vector: number[];
  /** Computed from the subject's access column: vector[1] is then a hash of that column. */
  column: boolean;
  /** Unix seconds of the earliest expiring grant, if any. */
  expiresAt: number | null;
  checkedAt: number;
};

type Snapshot = {
  registry: number;
  version: number;
  roles: Map<number, { name: string; bits: Bitmap }>;
};

export type ResolverOptions = {
  store: PermissionStore;
  registry: PermissionRegistry;
  scopes: ScopeTree;
  versions: VersionStore;
  cache?: SharedCache;
  /** How long an entry is trusted without re-reading counters (`eventual`). */
  ttlMs?: number;
  /** `strict` re-reads counters on every uncached request; `eventual` trusts memory for `ttlMs`. */
  consistency?: "strict" | "eventual";
  maxEntries?: number;
  now?: () => number;
  /** Told when the shared cache or counters fail; the resolver then answers from the database. */
  onError?: (error: unknown, where: string) => void;
};

export const registryKey = "registry";
export const subjectKey = (subject: Subject): string => `s:${subject.type}:${subject.id}`;
export const scopeKey = (scope: string): string => `c:${scope}`;

const sameVector = (a: number[], b: number[]): boolean => a.length === b.length && a.every((value, i) => value === b[i]);

export class PermissionResolver {
  readonly #store: PermissionStore;
  readonly #registry: PermissionRegistry;
  readonly #scopes: ScopeTree;
  readonly #versions: VersionStore;
  readonly #cache?: SharedCache;
  readonly #ttlMs: number;
  readonly #consistency: "strict" | "eventual";
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #onError: (error: unknown, where: string) => void;
  /** One map per request (set by `runRequest`): a consistent view and no repeated counter reads. */
  readonly #memo = new AsyncLocalStorage<Map<string, EffectiveSet>>();

  #entries = new Map<string, EffectiveSet>();
  #snapshots = new Map<string, Snapshot>();
  #chains = new Map<string, { chain: string[]; at: number }>();
  #inflight = new Map<string, Promise<EffectiveSet>>();
  #registryVersion = -1;
  #registryLoad?: Promise<void>;

  constructor(options: ResolverOptions) {
    this.#store = options.store;
    this.#registry = options.registry;
    this.#scopes = options.scopes;
    this.#versions = options.versions;
    this.#cache = options.cache;
    this.#ttlMs = options.ttlMs ?? 5_000;
    this.#consistency = options.consistency ?? "eventual";
    this.#maxEntries = options.maxEntries ?? 10_000;
    this.#now = options.now ?? Date.now;
    this.#onError = options.onError ?? (() => {});
  }

  /** Run `fn` with a per-request memo (reused if one is already active). */
  runRequest<T>(fn: () => T): T {
    return this.#memo.getStore() ? fn() : this.#memo.run(new Map(), fn);
  }

  /**
   * Drop what this process holds for the changed counters (call after local writes).
   * A subject change only drops that subject; a scope or registry change drops everything,
   * because any member of the scope may be affected.
   */
  invalidate(keys: string[]): void {
    this.#memo.getStore()?.clear();
    for (const key of keys) {
      if (key.startsWith("s:")) {
        const prefix = `${key.slice(2)}|`;
        for (const entryKey of [...this.#entries.keys()]) {
          if (entryKey.startsWith(prefix)) this.#entries.delete(entryKey);
        }
        for (const inflightKey of [...this.#inflight.keys()]) {
          if (inflightKey.startsWith(prefix)) this.#inflight.delete(inflightKey);
        }
      } else {
        this.#entries.clear();
        this.#snapshots.clear();
        this.#chains.clear();
        this.#inflight.clear();
        return;
      }
    }
  }

  async effective(subject: Subject, scope: string): Promise<EffectiveSet> {
    const key = `${subject.type}:${subject.id}|${scope}`;
    const now = this.#now();
    const memo = this.#memo.getStore();
    const remembered = memo?.get(key);
    if (
      remembered &&
      !this.#expired(remembered, now) &&
      (!remembered.column || (typeof subject.access === "string" && hashAccess(subject.access) === remembered.vector[1]))
    ) {
      return remembered;
    }
    const hit = this.#entries.get(key);
    if (
      hit &&
      !this.#expired(hit, now) &&
      this.#consistency === "eventual" &&
      now - hit.checkedAt < this.#ttlMs &&
      // A column-derived entry follows the column: a freshly loaded row with other contents wins at once.
      (!hit.column || (typeof subject.access === "string" && hashAccess(subject.access) === hit.vector[1]))
    ) {
      return hit;
    }
    const running = this.#inflight.get(key);
    if (running) return running;
    const load = this.#refresh(subject, scope, key, hit)
      .then((entry) => {
        memo?.set(key, entry);
        return entry;
      })
      .finally(() => {
        if (this.#inflight.get(key) === load) this.#inflight.delete(key);
      });
    this.#inflight.set(key, load);
    return load;
  }

  /** The cached set for a subject in a scope if it is in memory and fresh; never loads anything. */
  peek(subject: Subject, scope: string): EffectiveSet | undefined {
    const key = `${subject.type}:${subject.id}|${scope}`;
    const hit = this.#memo.getStore()?.get(key) ?? this.#entries.get(key);
    if (!hit) return undefined;
    const now = this.#now();
    if (this.#expired(hit, now) || now - hit.checkedAt >= this.#ttlMs) return undefined;
    if (hit.column && (typeof subject.access !== "string" || hashAccess(subject.access) !== hit.vector[1])) return undefined;
    return hit;
  }

  #expired(entry: EffectiveSet, nowMs: number): boolean {
    return entry.expiresAt !== null && entry.expiresAt * 1000 <= nowMs;
  }

  async #chain(scope: string): Promise<string[]> {
    const now = this.#now();
    const cached = this.#chains.get(scope);
    if (cached && now - cached.at < this.#ttlMs) return cached.chain;
    const chain = await this.#scopes.chain(scope);
    this.#chains.set(scope, { chain, at: now });
    return chain;
  }

  async #ensureRegistry(version: number): Promise<void> {
    if (this.#registryVersion === version) return;
    this.#registryLoad ??= (async () => {
      this.#registry.load(await this.#store.permissionRows());
      this.#registryVersion = version;
    })().finally(() => {
      this.#registryLoad = undefined;
    });
    await this.#registryLoad;
    if (this.#registryVersion !== version) {
      // Counter moved while loading: the rows we read are at least as new, accept them.
      this.#registryVersion = version;
    }
  }

  async #refresh(subject: Subject, scope: string, key: string, hit: EffectiveSet | undefined): Promise<EffectiveSet> {
    const chain = await this.#chain(scope);
    const claimed = typeof subject.access === "string" ? parseAccess(subject.access) : null;
    let column = claimed !== null && !claimed.overflow ? claimed : null;

    // Counters are read BEFORE any data, so a concurrent write can only make our entry look stale, never fresh.
    // If they cannot be read at all, answer from the database and keep nothing (degraded).
    let degraded = false;
    let vector: number[];
    try {
      if (column && column.version === undefined) {
        // The subject's own counter is not needed: the column is the subject's current grants.
        const counters = await this.#versions.get([registryKey, ...chain.map(scopeKey)]);
        vector = [counters[0]!, hashAccess(subject.access!), ...counters.slice(1)];
      } else {
        vector = await this.#versions.get([registryKey, subjectKey(subject), ...chain.map(scopeKey)]);
        if (column) {
          // Claims issued under a counter: valid only while the subject has not changed since.
          if (column.version === vector[1]) vector = [vector[0]!, hashAccess(subject.access!), ...vector.slice(2)];
          else column = null;
        }
      }
      await this.#ensureRegistry(vector[0]!);
    } catch (error) {
      this.#onError(error, "versions");
      degraded = true;
      column = column && column.version === undefined ? column : null;
      vector = [0, 0, ...chain.map(() => 0)];
      this.#registry.load(await this.#store.permissionRows());
    }
    const fromColumn = column !== null;

    const now = this.#now();
    if (!degraded && hit && hit.column === fromColumn && sameVector(hit.vector, vector) && !this.#expired(hit, now)) {
      hit.checkedAt = now;
      return hit;
    }

    if (this.#cache && !degraded) {
      const shared = decodeEntry(await this.#sharedGet(`perm:eff:${key}`));
      if (shared && shared.column === fromColumn && sameVector(shared.vector, vector) && !this.#expired(shared, now)) {
        shared.checkedAt = now;
        this.#remember(key, shared);
        return shared;
      }
    }

    const snapshots = new Map<string, Snapshot>();
    const missing: string[] = [];
    for (let i = 0; i < chain.length; i++) {
      const snapshot = degraded ? null : await this.#snapshotFor(chain[i]!, vector[0]!, vector[2 + i]!);
      if (snapshot) snapshots.set(chain[i]!, snapshot);
      else missing.push(chain[i]!);
    }

    const nowSeconds = Math.floor(now / 1000);
    let load: ColdLoad;
    if (column) {
      const inChain = new Set(chain);
      const grants = column.grants.filter((g) => inChain.has(g.scope) && (g.expiresAt === null || g.expiresAt > nowSeconds));
      load = missing.length > 0 ? await this.#store.loadRoles(chain) : { grants: [] };
      load.grants = grants;
    } else {
      load = await this.#store.loadCold(subject, chain, missing.length > 0, nowSeconds);
    }
    if (load.roles) {
      for (let i = 0; i < chain.length; i++) {
        const built = this.#build(load, chain[i]!, vector[0]!, vector[2 + i]!);
        snapshots.set(chain[i]!, built);
        if (!degraded) this.#keepSnapshot(chain[i]!, built);
      }
    }

    const entry = this.#compute(load, snapshots, vector, now, fromColumn);
    if (!degraded) {
      this.#remember(key, entry);
      if (this.#cache) void this.#sharedPut(`perm:eff:${key}`, encodeEntry(entry));
    }
    return entry;
  }

  /** Build and keep the role snapshots of a scope (and its parents) without any subject: `permissions:warm`. */
  async warmScope(scope: string): Promise<void> {
    const chain = await this.#chain(scope);
    const vector = await this.#versions.get([registryKey, ...chain.map(scopeKey)]);
    await this.#ensureRegistry(vector[0]!);
    const load = await this.#store.loadRoles(chain);
    for (let i = 0; i < chain.length; i++) {
      this.#keepSnapshot(chain[i]!, this.#build(load, chain[i]!, vector[0]!, vector[1 + i]!));
    }
  }

  #keepSnapshot(scope: string, snapshot: Snapshot): void {
    this.#snapshots.set(scope, snapshot);
    if (this.#cache) void this.#sharedPut(`perm:snap:${scope}`, encodeSnapshot(snapshot));
  }

  /** A failing shared cache is a miss, never an error for the caller. */
  async #sharedGet(key: string): Promise<unknown> {
    try {
      return await this.#cache!.get(key);
    } catch (error) {
      this.#onError(error, "cache.get");
      return undefined;
    }
  }

  async #sharedPut(key: string, value: unknown): Promise<void> {
    try {
      await this.#cache!.put(key, value, 3600);
    } catch (error) {
      this.#onError(error, "cache.put");
    }
  }

  async #snapshotFor(scope: string, registryVersion: number, version: number): Promise<Snapshot | null> {
    const local = this.#snapshots.get(scope);
    if (local && local.registry === registryVersion && local.version === version) return local;
    if (this.#cache) {
      const shared = decodeSnapshot(await this.#sharedGet(`perm:snap:${scope}`));
      if (shared && shared.registry === registryVersion && shared.version === version) {
        this.#snapshots.set(scope, shared);
        return shared;
      }
    }
    return null;
  }

  #build(load: ColdLoad, scope: string, registryVersion: number, version: number): Snapshot {
    const roles = new Map<number, { name: string; bits: Bitmap }>();
    for (const role of load.roles ?? []) {
      if (role.scope === scope) roles.set(role.id, { name: role.name, bits: emptyBitmap(this.#registry.size + 1) });
    }
    for (const row of load.rolePermissions ?? []) {
      const role = roles.get(row.roleId);
      if (role) role.bits = orInto(role.bits, this.#registry.bitsFor(row.permissionId));
    }
    return { registry: registryVersion, version, roles };
  }

  #compute(load: ColdLoad, snapshots: Map<string, Snapshot>, vector: number[], now: number, column: boolean): EffectiveSet {
    const roles = new Map<number, { name: string; bits: Bitmap }>();
    for (const snapshot of snapshots.values()) for (const [id, role] of snapshot.roles) roles.set(id, role);

    let bits = emptyBitmap(this.#registry.size + 1);
    const roleNames = new Set<string>();
    let expiresAt: number | null = null;
    for (const grant of load.grants) {
      if (grant.expiresAt !== null && (expiresAt === null || grant.expiresAt < expiresAt)) expiresAt = grant.expiresAt;
      if (grant.kind === GRANT_ROLE) {
        const role = roles.get(grant.target);
        if (!role) continue;
        roleNames.add(role.name);
        bits = orInto(bits, role.bits);
      } else if (grant.kind === GRANT_PERMISSION) {
        bits = orInto(bits, this.#registry.bitsFor(grant.target));
      }
    }
    return { bits, roleNames, vector, column, expiresAt, checkedAt: now };
  }

  #remember(key: string, entry: EffectiveSet): void {
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    if (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
  }
}

function encodeEntry(entry: EffectiveSet): unknown {
  return { bits: bitmapToBase64(entry.bits), roles: [...entry.roleNames], vector: entry.vector, column: entry.column, expiresAt: entry.expiresAt };
}

function decodeEntry(raw: unknown): EffectiveSet | null {
  const value = raw as { bits?: string; roles?: string[]; vector?: number[]; column?: boolean; expiresAt?: number | null } | null;
  if (!value || typeof value.bits !== "string" || !Array.isArray(value.vector)) return null;
  return {
    bits: bitmapFromBase64(value.bits),
    roleNames: new Set(value.roles ?? []),
    vector: value.vector,
    column: value.column === true,
    expiresAt: value.expiresAt ?? null,
    checkedAt: 0,
  };
}

function encodeSnapshot(snapshot: Snapshot): unknown {
  return {
    registry: snapshot.registry,
    version: snapshot.version,
    roles: [...snapshot.roles].map(([id, role]) => [id, role.name, bitmapToBase64(role.bits)]),
  };
}

function decodeSnapshot(raw: unknown): Snapshot | null {
  const value = raw as { registry?: number; version?: number; roles?: Array<[number, string, string]> } | null;
  if (!value || typeof value.registry !== "number" || !Array.isArray(value.roles)) return null;
  return {
    registry: value.registry,
    version: value.version ?? 0,
    roles: new Map(value.roles.map(([id, name, bits]) => [id, { name, bits: bitmapFromBase64(bits) }])),
  };
}
