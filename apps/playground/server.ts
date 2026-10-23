import type { Database } from "bun:sqlite";
import { verifyCsrf } from "@bunyad/auth";
import { DebugbarServiceProvider } from "@bunyad/debugbar";
import { bunyad } from "@bunyad/framework";
import "@bunyad/framework/globals";
import { handleHead } from "@bunyad/head";
import { Model } from "@bunyad/orm";
import { handleUrl } from "@bunyad/router";
import { startSession } from "@bunyad/session";
import HandleInertiaRequests from "@/Http/Middleware/HandleInertiaRequests.ts";
import SetHeader from "@/Http/Middleware/SetHeader.ts";
import AppServiceProvider from "@/Providers/AppServiceProvider.ts";
import { bunBenchResponse, prepareBenchSqlite, seedBenchSqlite } from "@/Support/bench-routes.ts";

export const createApplication = bunyad(import.meta, {
  middleware: [new SetHeader()],
  groups: {
    web: [handleHead(), startSession(), handleUrl(), verifyCsrf(), new HandleInertiaRequests()],
    api: [],
  },
  // Development only: the debugbar disables itself in production, tests and console.
  providers: [DebugbarServiceProvider, AppServiceProvider],
  // The microbench routes under `/bench/bun/*` answer straight from SQLite, before the router.
  serve() {
    const connection = Model.getConnection();
    if (connection.driver !== "sqlite") return {};
    const db = connection.raw as Database;
    seedBenchSqlite(db);
    const sqlite = prepareBenchSqlite(db);
    return {
      fetch(request, _server, next) {
        return bunBenchResponse(request, sqlite) ?? next(request);
      },
    };
  },
});
