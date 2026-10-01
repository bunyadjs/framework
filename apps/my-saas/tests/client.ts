import { resolve } from "node:path";
import { TestClient } from "@bunyad/testing";
import { createApplication } from "../bootstrap/app.ts";

const dbFile = resolve(import.meta.dir, "../database/testing.sqlite");
const migrationsPath = resolve(import.meta.dir, "../database/migrations");

/** Browser-style headers, so validation errors redirect back instead of returning JSON. */
export const browser = { Accept: "text/html" };

/** A client on a fresh database with in-memory sessions. */
export async function client(): Promise<TestClient> {
  // Two-factor secrets are encrypted; tests use a fixed key when `.env` has none.
  process.env.APP_KEY ||= `base64:${Buffer.alloc(32, 1).toString("base64")}`;
  process.env.SESSION_DRIVER = "memory";
  process.env.DATABASE_PATH = dbFile;
  return TestClient.create({ createApplication, migrationsPath });
}
