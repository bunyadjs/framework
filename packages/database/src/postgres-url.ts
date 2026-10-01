import type { PostgresOptions } from "./connection-contract.ts";

/**
 * Strip Prisma-only query params (`schema=…`) from a Postgres URL.
 * Drivers may apply remaining query params as `SET` options; Postgres rejects `schema`.
 */
export function sanitizePostgresUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("schema");
    const search = parsed.searchParams.toString();
    parsed.search = search ? `?${search}` : "";
    return parsed.toString();
  } catch {
    return url.replace(/([?&])schema=[^&]*/g, "$1").replace(/[?&]$/, "");
  }
}

/**
 * Always connect via a URL string when possible.
 * Object/env forms can still leak Prisma `schema=` params into driver SET options.
 */
export function postgresConnectionUrl(options: PostgresOptions = {}): string {
  if (options.url) {
    return sanitizePostgresUrl(options.url);
  }
  const user = encodeURIComponent(options.username ?? "postgres");
  const password = encodeURIComponent(options.password ?? "");
  const host = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 5432;
  const database = encodeURIComponent(options.database ?? "bunyad");
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}
