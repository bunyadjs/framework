import { resolve } from "node:path";
import type { Application } from "@bunyad/core";
import { createFetchHandler } from "@bunyad/core";
import { DB } from "@bunyad/database";
import { Model } from "@bunyad/orm";
import { refreshDatabase } from "@bunyad/testing";
import { createApplication } from "../bootstrap/app.ts";
import { seedSecondaryUsers } from "../database/seeders/SecondaryUserSeeder.ts";

/** Separate from serve's database.sqlite so tests don't unlink an open vnode. */
export const dbFile = resolve(import.meta.dir, "../database/testing.sqlite");
export const migrationsPath = resolve(import.meta.dir, "../database/migrations");
export const clientDbFile = resolve(import.meta.dir, "../database/testing-client.sqlite");

export type BootAppOptions = {
  databasePath?: string;
  broadcastDriver?: string;
};

/** Boot playground app and reset database (Laravel `RefreshDatabase`). */
export async function bootApp(options: BootAppOptions = {}): Promise<{
  app: Application;
  fetch: (request: Request) => Promise<Response>;
}> {
  process.env.SESSION_DRIVER = "memory";
  process.env.DATABASE_PATH = options.databasePath ?? dbFile;
  if (options.broadcastDriver) {
    process.env.BROADCAST_DRIVER = options.broadcastDriver;
  }
  const app = await createApplication();
  await refreshDatabase({
    connection: Model.getConnection(),
    migrationsPath,
  });
  await refreshDatabase({
    connection: DB.connection("secondary"),
    migrationsPath,
    seed: seedSecondaryUsers,
  });
  return { app, fetch: createFetchHandler(app) };
}

/**
 * Take the cookies and CSRF token a response sets, as a browser would. Logging
 * in regenerates the session, so the old cookie no longer signs anyone in.
 */
export function follow(res: Response, current: { cookie: string; token: string }) {
  const jar = new Map(
    current.cookie.split(";").map((part) => part.trim()).filter(Boolean).map((part) => [part.split("=")[0]!, part] as const),
  );
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";")[0]!.trim();
    jar.set(pair.split("=")[0]!, pair);
  }
  return { cookie: [...jar.values()].join("; "), token: res.headers.get("X-CSRF-TOKEN") ?? current.token };
}

export async function session(fetch: (request: Request) => Promise<Response>) {
  const res = await fetch(new Request("http://localhost/"));
  const lines = res.headers.getSetCookie();
  const cookie = lines
    .map((line) => line.split(";")[0]?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join("; ");
  const token = res.headers.get("X-CSRF-TOKEN")!;
  return { cookie, token };
}
