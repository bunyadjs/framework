/**
 * Process-wide shutdown coordination for long-running servers and workers.
 */

let controller: AbortController | undefined;
let installed = false;

/** Shared abort signal for daemons (`queue:work`, `schedule:work`, HTTP serve). */
export function shutdownSignal(): AbortSignal {
  return (controller ??= new AbortController()).signal;
}

/** Register a callback when shutdown is requested (SIGINT/SIGTERM or `requestShutdown`). */
export function onShutdown(fn: () => void | Promise<void>): void {
  const signal = shutdownSignal();
  if (signal.aborted) {
    void Promise.resolve(fn());
    return;
  }
  signal.addEventListener(
    "abort",
    () => {
      void Promise.resolve(fn());
    },
    { once: true },
  );
}

/** Abort the shared shutdown signal. */
export function requestShutdown(reason = "shutdown"): void {
  controller ??= new AbortController();
  if (!controller.signal.aborted) {
    controller.abort(reason);
  }
}

/**
 * Listen for SIGINT/SIGTERM once and abort `shutdownSignal()`.
 * Idempotent — safe to call from `serve()` and worker entries.
 */
export function installShutdownHandlers(): AbortSignal {
  const signal = shutdownSignal();
  if (installed) return signal;
  installed = true;

  const stop = () => requestShutdown("signal");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return signal;
}

/** Test helper — clear handlers/controller between cases. */
export function resetShutdownForTests(): void {
  controller = undefined;
  installed = false;
}
