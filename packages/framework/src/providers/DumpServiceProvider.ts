import { flockDumpUrl, flockIngest } from "@bunyad/common";
import { ServiceProvider } from "@bunyad/core";
import { DB } from "@bunyad/database";

/**
 * When a dump ingest URL is configured, subscribe to query timings.
 * `dump()` / `dd()` post themselves; views, jobs, and HTTP are not recorded.
 */
export function registerDumpQueryListener(): (() => void) | undefined {
  if (!flockDumpUrl()) {
    return undefined;
  }
  return DB.listen((event) => {
    void flockIngest(
      "query",
      {
        sql: event.sql,
        durationMs: event.timeMs,
        bindings: event.bindings,
      },
      { locate: false },
    );
  });
}

export class DumpServiceProvider extends ServiceProvider {
  boot(): void {
    registerDumpQueryListener();
  }
}
