---
title: Package Development
description: Build a workspace package with a ServiceProvider that applications register at boot.
---

# Package Development

## Introduction

Bunyad itself is a monorepo of packages under `packages/`. Application code depends on those packages through Bun workspaces (`"@bunyad/queue": "workspace:*"` and similar). You can add your own package the same way: a folder with a `package.json`, TypeScript sources, and a `ServiceProvider` that apps register from `bootstrap/providers.ts`.

This page covers that pattern. Config files typically live in each application under `config/`. Packages can also register publishable paths with `publishes()` on a `ServiceProvider` and ship them with `bunyad publish` (optionally `--tag=` / `--force`).

To **consume** an existing `@bunyad/*` package in a plain Bun project (routing, ORM, cache, validation, …) without writing a provider, see [using packages alone](/docs/1.x/standalone).

For how providers `register` and `boot` in an application, see [service providers](/docs/1.x/providers). For container bindings, see the [service container](/docs/1.x/container).

## Package layout

Inside the Bunyad repository, add a workspace member under `packages/`:

```text
packages/acme-billing/
  package.json
  src/
    index.ts
    AcmeBillingServiceProvider.ts
    BillingClient.ts
```

The root `package.json` already includes `"workspaces": ["packages/*", ...]`, so `packages/acme-billing` is picked up on the next `bun install`.

A minimal `package.json`:

```json
{
  "name": "@acme/billing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "dependencies": {
    "@bunyad/core": "workspace:*",
    "@bunyad/http": "workspace:*"
  },
  "scripts": {
    "test": "bun test"
  }
}
```

Export the public API from `src/index.ts`:

```ts
export { AcmeBillingServiceProvider } from "./AcmeBillingServiceProvider.ts";
export { BillingClient } from "./BillingClient.ts";
```

Point application `package.json` dependencies at the workspace name:

```json
{
  "dependencies": {
    "@acme/billing": "workspace:*"
  }
}
```

Outside this monorepo, publish the package to a registry and depend on a semver range instead of `workspace:*`. The provider and config patterns stay the same.

## Service providers

A package integrates with an application by extending `ServiceProvider` from `@bunyad/core`. The constructor receives the `Application` (also the container) as `this.app`.

Put container bindings in `register`. Put work that needs other providers' bindings in `boot`:

```ts
import { ServiceProvider } from "@bunyad/core";
import { BillingClient } from "./BillingClient.ts";

export type AcmeBillingConfig = {
  apiKey?: string;
  baseUrl?: string;
};

export class AcmeBillingServiceProvider extends ServiceProvider {
  register(): void {
    const config = this.app.config.get<AcmeBillingConfig>("billing") ?? {};

    this.app.singleton(BillingClient, () => {
      return new BillingClient({
        apiKey: config.apiKey ?? process.env.ACME_BILLING_KEY ?? "",
        baseUrl: config.baseUrl ?? "https://api.example.com",
      });
    });
  }

  boot(): void {
    // Resolve other services, register listeners, attach routes, …
  }
}
```

This matches how framework packages wire themselves. For example, `QueueServiceProvider` builds the queue manager from `config/queue`, calls `setQueue`, and binds `"queue"`. `FeatureServiceProvider` reads `config/features` and optionally swaps the feature store. Your package should follow the same shape: read config, bind services, optionally call package setters.

`boot` may return a promise. The application awaits it before boot callbacks run. `boot` receives no arguments; resolve collaborators with `this.app.make(...)`.

## Registering the provider

Applications list providers in `bootstrap/providers.ts`. Framework providers run first via `registerFrameworkProviders`; your package provider is an application registration:

```ts
import type { Application } from "@bunyad/core";
import AppServiceProvider from "@/Providers/AppServiceProvider.ts";
import { AcmeBillingServiceProvider } from "@acme/billing";

export function registerProviders(app: Application): void {
  app.register(AppServiceProvider);
  app.register(AcmeBillingServiceProvider);
}
```

`app.register` constructs the class with the application, calls `register` immediately, and queues `boot` until every provider has registered. After that, `this.app.make(BillingClient)` works anywhere the app has booted.

You can also pass a plain object when you do not need a class:

```ts
app.register({
  register(app) {
    app.singleton(BillingClient, () => new BillingClient());
  },
});
```

## Configuration

Applications own `config/*.ts`. The framework loads those modules into `app.config`. Your package should document a recommended file, for example `config/billing.ts`:

```ts
export default {
  apiKey: process.env.ACME_BILLING_KEY,
  baseUrl: process.env.ACME_BILLING_URL ?? "https://api.example.com",
};
```

Inside the provider, read it with `this.app.config.get("billing")`. Prefer environment fallbacks so an app can start without copying a file. There is no `bunyad` command that copies package config into the application; keep the sample in your package README or docs.

## Facades and package APIs

Many first-party packages expose a small facade or helper next to the provider (`Queue`, `Cache`, `schedule()`, `dispatch`). If your package needs a global entry point, export functions that read a module-level singleton set during `register`:

```ts
let client: BillingClient | undefined;

export function setBillingClient(value: BillingClient): void {
  client = value;
}

export function billing(): BillingClient {
  if (!client) {
    throw new Error("Acme billing is not configured. Register AcmeBillingServiceProvider.");
  }
  return client;
}
```

Call `setBillingClient` from the provider after you construct the instance. Application code then imports `billing` from `@acme/billing` instead of resolving the container every time.

## Routes, views, and commands

HTTP routes belong in the application (`routes/web.ts`, `routes/api.ts`) or in a function your provider calls from `boot` that registers routes on `@bunyad/router`. Keep route registration behind an explicit export such as `registerBillingRoutes()` so apps opt in.

View templates stay in the application's `resources/views` unless you compile strings yourself. Prefer documenting a sample config module, or use `publishes()` + `bunyad publish` when a package needs to drop files into the app.

Console commands that ship with the framework live in `@bunyad/cli`. Application commands are discovered under `app/Console/Commands` (see [console](/docs/1.x/console)). A package that needs a command can:

1. Document a class users copy into `app/Console/Commands`, or
2. Export a `Command` subclass and have the application re-export it from that directory, or
3. Contribute a built-in command inside `@bunyad/cli` when you are extending the framework itself.

Scheduled tasks remain in the application's `routes/console.ts` (see [task scheduling](/docs/1.x/scheduling)).

## Testing packages

Colocate `bun test` files next to the package sources. Resolve the provider against a minimal `Application` in unit tests, or boot a playground app that registers your provider for integration coverage:

```ts
import { test, expect } from "bun:test";
import { Application } from "@bunyad/core";
import { AcmeBillingServiceProvider } from "./AcmeBillingServiceProvider.ts";
import { BillingClient } from "./BillingClient.ts";

test("provider binds BillingClient", () => {
  const app = new Application({
    config: { billing: { apiKey: "test" } },
  });
  app.register(AcmeBillingServiceProvider);
  expect(app.make(BillingClient)).toBeInstanceOf(BillingClient);
});
```

Prefer testing the public exports of `@acme/billing` the same way application code will import them.

## First-party packages

Official packages follow this layout today: `@bunyad/queue`, `@bunyad/schedule`, `@bunyad/cache`, `@bunyad/mail`, and the rest under `packages/`. `@bunyad/framework` registers their providers through `registerFrameworkProviders`. When you add a capability that every starter should load, wire a provider there. When the capability is optional, keep the provider in the feature package and let applications call `app.register` themselves.
