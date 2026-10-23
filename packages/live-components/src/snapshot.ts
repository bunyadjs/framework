import { createHmac, randomUUID } from "node:crypto";

export type Snapshot = {
  name: string;
  /** Stable instance id for multi-component pages. */
  id: string;
  data: Record<string, unknown>;
  checksum: string;
  /** Nested component snapshots keyed by embed key. */
  children?: Record<string, Snapshot>;
};

export type LiveCall = {
  method: string;
  params?: unknown[];
};

export type LiveUpdatePayload = {
  name: string;
  snapshot: Snapshot;
  calls?: LiveCall[];
  updates?: Record<string, unknown>;
  /** Live nested snapshots from the DOM (override stale `snapshot.children`). */
  children?: Record<string, Snapshot>;
};

export type LiveEvent = {
  name: string;
  params?: Record<string, unknown>;
};

export type LiveEffects = {
  events?: LiveEvent[];
  redirect?: string | null;
  /** SPA navigate (live:navigate) instead of full page reload. */
  navigate?: string | null;
  errors?: Record<string, string[]>;
};

export type LiveUpdateResult = {
  html: string;
  snapshot: Snapshot;
  effects: LiveEffects;
};

function isProduction(): boolean {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "production";
  return env === "production";
}

function signingKey(): string {
  const raw = process.env.APP_KEY;
  if (raw && raw.length > 0) return raw;
  if (isProduction()) {
    throw new Error(
      "APP_KEY is not set. Live snapshot signing requires APP_KEY in production.",
    );
  }
  // Dev/test only — never used when APP_ENV/NODE_ENV is production.
  return "bunyad-insecure-dev-key-do-not-use-in-production!!";
}

function childrenPayload(
  children?: Record<string, Snapshot>,
): string {
  if (!children || Object.keys(children).length === 0) return "";
  const keys = Object.keys(children).sort();
  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    const child = children[key]!;
    normalized[key] = {
      name: child.name,
      id: child.id,
      data: child.data,
      checksum: child.checksum,
      children: child.children ?? {},
    };
  }
  return JSON.stringify(normalized);
}

/** Sign snapshot data so clients cannot invent server state. */
export function checksumFor(
  name: string,
  id: string,
  data: Record<string, unknown>,
  children?: Record<string, Snapshot>,
): string {
  return createHmac("sha256", signingKey())
    .update(name)
    .update("\0")
    .update(id)
    .update("\0")
    .update(JSON.stringify(data))
    .update("\0")
    .update(childrenPayload(children))
    .digest("hex");
}

/** Embed a snapshot in `data-snapshot` (UTF-8 JSON → standard base64). */
export function encodeSnapshotAttribute(snapshot: Snapshot): string {
  return Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64");
}

/** Inverse of `encodeSnapshotAttribute` (not Latin-1 `atob` alone). */
export function decodeSnapshotAttribute(encoded: string): Snapshot {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Snapshot;
}

export function makeSnapshot(
  name: string,
  data: Record<string, unknown>,
  id?: string,
  children?: Record<string, Snapshot>,
): Snapshot {
  const snapshotId = id ?? randomUUID();
  const childMap =
    children && Object.keys(children).length > 0 ? children : undefined;
  return {
    name,
    id: snapshotId,
    data,
    children: childMap,
    checksum: checksumFor(name, snapshotId, data, childMap),
  };
}

export function assertSnapshot(snapshot: Snapshot): void {
  const id = snapshot.id ?? "";
  const expected = checksumFor(
    snapshot.name,
    id,
    snapshot.data,
    snapshot.children,
  );
  if (snapshot.checksum !== expected) {
    throw new Error("Invalid Live snapshot checksum.");
  }
  if (snapshot.children) {
    for (const child of Object.values(snapshot.children)) {
      assertSnapshot(child);
    }
  }
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
