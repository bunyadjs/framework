import { expect } from "bun:test";
import { resolve } from "node:path";
import { TestClient } from "@bunyad/testing";
import { createApplication } from "../bootstrap/app.ts";

const dbFile = resolve(import.meta.dir, "../database/testing.sqlite");
const migrationsPath = resolve(import.meta.dir, "../database/migrations");

/** Headers an Inertia visit sends, so pages come back as JSON. */
export const inertia = { "X-Inertia": "true", Accept: "text/html, application/xhtml+xml" };

/** A client on a fresh database with in-memory sessions. */
export async function client(): Promise<TestClient> {
  // Two-factor secrets are encrypted; tests use a fixed key when `.env` has none.
  process.env.APP_KEY ||= `base64:${Buffer.alloc(32, 1).toString("base64")}`;
  process.env.SESSION_DRIVER = "memory";
  process.env.DATABASE_PATH = dbFile;
  return TestClient.create({ createApplication, migrationsPath });
}

export type Page = {
  component: string;
  props: Record<string, any> & { errors: Record<string, any>; status: string | null };
};

/** Visit `path` as Inertia does and return the page it renders. */
export async function visit(app: TestClient, path: string): Promise<Page> {
  const response = await app.get(path, inertia);
  response.assertOk();
  return (await response.json()) as Page;
}

/** Visit `path` and check which page component it renders. */
export async function expectPage(app: TestClient, path: string, component: string): Promise<Page> {
  const page = await visit(app, path);
  expect(page.component).toBe(component);
  return page;
}
