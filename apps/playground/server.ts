import type { Database } from "bun:sqlite";
import { serve } from "@bunyad/core";
import { Model } from "@bunyad/orm";
import { createApplication } from "./bootstrap/app.ts";
import {
  bunBenchResponse,
  prepareBenchSqlite,
  seedBenchSqlite,
} from "./app/Support/bench-routes.ts";

const app = await createApplication();
const connection = Model.getConnection();

if (connection.driver !== "sqlite") {
  serve(app);
} else {
  const db = connection.raw as Database;
  seedBenchSqlite(db);
  const sqlite = prepareBenchSqlite(db);
  serve(app, {
    fetch(request, _server, next) {
      return bunBenchResponse(request, sqlite) ?? next(request);
    },
  });
}
