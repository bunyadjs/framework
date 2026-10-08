import type { GrantRow } from "./store.ts";
import type { GrantKind } from "./types.ts";

/**
 * The `column` grant source keeps a subject's grants in one text column on the subject's own row,
 * so a user the app already loaded needs no grants query at all.
 *
 * Format: `{"v":1,"g":[[scope,kind,target,expiresAt|0],...]}`, or `{"v":1,"o":1}` when the subject
 * holds too many grants for a column (readers then use the grants table).
 * `null` / missing means "not materialized yet": readers use the grants table too.
 */
export type ParsedAccess = {
  grants: GrantRow[];
  overflow: boolean;
  /** Set on claims issued by `issueClaims`: the subject counter they were issued under. */
  version?: number;
};

export const DEFAULT_MAX_COLUMN_GRANTS = 100;

export function encodeAccess(grants: GrantRow[], max = DEFAULT_MAX_COLUMN_GRANTS, version?: number): string {
  if (grants.length > max) return '{"v":1,"o":1}';
  const body: Record<string, unknown> = { v: 1, g: grants.map((g) => [g.scope, g.kind, g.target, g.expiresAt ?? 0]) };
  if (version !== undefined) body.s = version;
  return JSON.stringify(body);
}

export function parseAccess(raw: string): ParsedAccess | null {
  try {
    const value = JSON.parse(raw) as { v?: number; o?: number; s?: number; g?: Array<[string, number, number, number]> };
    if (value.v !== 1) return null;
    if (value.o) return { grants: [], overflow: true };
    return {
      overflow: false,
      version: typeof value.s === "number" ? value.s : undefined,
      grants: (value.g ?? []).map(([scope, kind, target, expires]) => ({
        scope,
        kind: kind as GrantKind,
        target,
        expiresAt: expires === 0 ? null : expires,
      })),
    };
  } catch {
    return null;
  }
}

/** FNV-1a, 32 bit: cheap change detector for a column value. */
export function hashAccess(raw: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type AccessColumn = { table: string; column: string; key?: string };
