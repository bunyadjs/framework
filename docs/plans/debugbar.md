# `@bunyad/debugbar` — plan

A development-only debug bar for Bunyad apps: a bottom panel injected into HTML responses,
plus retained history so JSON/API/Inertia requests can be inspected too.

UI is modelled on the classic bottom-bar layout (tabs, badges, timeline). Retained history and
a machine-readable endpoint are modelled on the "inspector" approach. Neither upstream project
is installable here (both are PHP/Composer), so this is a native TypeScript package.

## Goals

- Zero-config in dev: register the provider, get a bar.
- Off in production by default; never injects into non-HTML responses.
- No runtime dependencies beyond other `@bunyad/*` packages. No build step for the UI
  (inline CSS + vanilla JS, one string).
- Works for HTML pages, JSON APIs and Inertia visits (via `X-Debugbar-Id`).
- Cheap when idle: collectors only record while a request context is active.

## Non-goals (v1)

- Production profiling (that is `@bunyad/metrics`).
- Persisting history across machines, or a hosted UI.
- Views/Events tabs (no per-render / wildcard class-event hook exists yet — see Follow-ups).

## Architecture

```
request ─▶ DebugbarMiddleware ─▶ [ router / controller / ORM / cache / log ]
              │  start RequestContext (AsyncLocalStorage)
              │  collectors push into the context
              ▼
        finish: build Snapshot ─▶ Store (ring buffer) ─▶ X-Debugbar-Id header
              ▼
        HTML? inject <div id="bunyad-debugbar"> + inline JS/CSS before </body>
```

| Piece | File | Notes |
|---|---|---|
| Context | `context.ts` | `AsyncLocalStorage<RequestContext>`; `Debugbar.measure/message/startTime` helpers |
| Store | `store.ts` | `MemoryDebugbarStore` (ring buffer, default 50) |
| Collectors | `collectors/*.ts` | `request`, `queries`, `logs`, `cache`, `exceptions`, `messages`, `timeline`, `memory` |
| Middleware | `middleware.ts` | context lifecycle, `/_debugbar*` endpoints, HTML injection |
| UI | `ui.ts` | bar markup + CSS + JS as strings; also the `/_debugbar` history page |
| Provider | `provider.ts` | `DebugbarServiceProvider`: gates on debug mode, wires collectors, prepends middleware |

### Hook points used (all already in Bunyad)

- Queries: `@bunyad/database` `listen()` → `{ sql, bindings, timeMs }`.
- Logs: wrap the default `LogChannel` (`setLogChannel`) and tee into the context.
- Cache: `CacheHit`, `CacheMissed`, `KeyWritten`, `KeyForgotten` via `Event.listen`.
- Exceptions: middleware catches and rethrows so the app's own handler still renders.
- Route/request: `request.route()`, `request.routeName`, headers, query, session.

### Endpoints (served by the middleware itself, so no router coupling)

- `GET /_debugbar` — history page.
- `GET /_debugbar/:id` — snapshot JSON (also the future MCP payload).
- `GET /_debugbar/latest` — latest snapshot JSON.

Gated by the same enabled check as the bar; 404 otherwise.

### Safety

- Enabled when `debugbar.enabled` (config) is true, else `app.hasDebugModeEnabled()`
  and not production and not running unit tests.
- Bindings and request/cookie/session values pass through a redactor
  (`password`, `token`, `secret`, `authorization`, `cookie`, `csrf`, … → `********`).
- Payload caps: max queries, max log lines, max string length per value.

## UI

Bottom bar: brand · request (`GET /path`, status) · route · queries (count + time) ·
time · memory · exceptions · logs · cache. Clicking an item opens a panel with tabs:
Messages, Timeline, Queries (duplicate + slow flags, copy SQL), Request, Route, Logs, Cache,
Exceptions. Dark-mode aware, collapsible, remembers open tab and height. Ajax/Inertia requests
appear in a dropdown (patched `fetch` / XHR read `X-Debugbar-Id`).

## Steps

1. [x] Plan.
2. [ ] Package scaffold (`package.json`, `tsconfig`, README, workspace wiring).
3. [ ] Context + store + redaction.
4. [ ] Collectors.
5. [ ] Middleware + endpoints + injection.
6. [ ] UI (bar + history page).
7. [ ] Provider + public API (`Debugbar` façade).
8. [ ] Tests (`bun test`): context isolation, query capture, redaction, injection rules,
       endpoints, disabled-in-production.
9. [ ] Wire into `apps/playground`.
10. [ ] Wire into `karobar-point-js/backend` (add to `link-bunyad.ts`, register provider,
        `DEBUGBAR` env flag, verify with the dev server).
11. [ ] Docs page + CHANGELOG entry.

## Follow-ups

- Views tab: needs a render hook in `@bunyad/view` `ViewFactory`.
- Events tab: needs a "dispatched" tap on `Dispatcher` (class events skip wildcards today).
- Models tab (hydrated model counts) via an ORM hook.
- MCP server exposing `/_debugbar/:id` for AI-assisted debugging.
- File-backed store so history survives `--watch` restarts.

## Status

Built and verified. Notes from implementation:

- `@bunyad/log` gained `listenLog()` (log writes are queued, so the request context is lost by the time a channel runs).
- `@bunyad/core` gained `listenException()` (the kernel renders errors inside the pipeline, so middleware never sees the throw).
- `app.runningInConsole()` is always true under Bun, so it is not used as a gate.
- karobar-point-js serves its SPA shell from Bunyad, so the SPA and the Inertia admin both get the bar.
