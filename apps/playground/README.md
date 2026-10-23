# Bunyad Playground

```bash
bunyad migrate
bunyad dev
```

## Where things are

```text
routes/      URLs, one folder each, with the controller, page and tests beside it
  (web)/     sessions, CSRF and Inertia: the demos, sign-in (React pages), notes, horizon
  (json)/    stateless JSON endpoints (`/users`, `/api/*`)
  (bench)/   microbench routes with no middleware
  _components/, _mail/   `<x-…>` components, Live widget templates and mail views
app/         models, events, jobs, mail, policies, middleware, Live components
```

Pages sit beside their controllers: `.view` templates for the server-rendered demos and `.tsx` for the Inertia ones (`routes/(web)/(guest)/login/LoginPage.tsx`). `bunyad build` bundles the React pages and copies `routes/app.css`.

## Highlights

- `GET /` — JSON hello (`Accept: application/json`) or the home page
- `GET /welcome` — HTML inside `MainLayout.view` (`@meta`, `{!! children !!}`)
- `POST /users` — validation + session flash (`Created Ada`)
- Sessions via `startSession` middleware
- `GET /notes` — Live notes (tenant-scoped)
- `GET /bench/hello` · `GET /bench/select` · `POST /bench/insert` — Bunyad kernel JSON / ORM
- `GET /bench/bun/hello` · `GET /bench/bun/select` · `POST /bench/bun/insert` — `Bun.serve` + `bun:sqlite` (same process)

```bash
# HTTP RPS vs Bun.serve + bun:sqlite (self-contained, no playground listen)
bun benchmarks/hello-and-sqlite.ts
```

