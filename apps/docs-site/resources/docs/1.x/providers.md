---
title: Service Providers
description: Register container bindings and boot application services from classes listed at startup.
---

# Service Providers

## Introduction

Service providers are where the application registers its services. A provider can bind classes into the [service container](/docs/1.x/container), attach middleware, or connect a package such as the session store. The framework loads your providers during boot, before the first route runs.

`register` runs first, for every provider. `boot` runs only after every provider has registered. Put container bindings in `register`. Put work that needs another provider's bindings in `boot`.

The request lifecycle page describes where this step sits between creating the application and dispatching the route.

## Writing Service Providers

A provider extends `ServiceProvider` from `@bunyad/core`. The constructor receives the `Application`, which is also the service container, on `this.app`.

```ts
import { ServiceProvider } from "@bunyad/core";
import Connection from "@/Services/Connection.ts";

export default class RiakServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(Connection, () => {
      return new Connection(this.app.config.get("riak"));
    });
  }
}
```

Place the file in `app/Providers/`. The class is a value import in `bootstrap/providers.ts`, so use `export default class`, not `export type`.

### The Register Method

Only bind services inside `register`. Do not register routes, event listeners, or anything else that might resolve a binding from a provider that has not run yet.

`singleton` stores one instance. `bind` builds a new instance on every `make`. Both are methods on `this.app`:

```ts
import { ServiceProvider } from "@bunyad/core";
import ServerProvider from "@/Contracts/ServerProvider.ts";
import DigitalOceanServerProvider from "@/Services/DigitalOceanServerProvider.ts";

export default class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.bind(ServerProvider, DigitalOceanServerProvider);
  }
}
```

`ServerProvider` must be a class. A TypeScript interface is not present at runtime, so it cannot be the container key.

### The Boot Method

`boot` runs after every provider's `register`. Resolve other services here, and register route patterns or listeners that depend on them:

```ts
import { ServiceProvider } from "@bunyad/core";
import { Route } from "@bunyad/router";

export default class AppServiceProvider extends ServiceProvider {
  boot(): void {
    Route.pattern("id", "[0-9]+");
  }
}
```

`boot` may return a promise. The application waits for it before the boot callbacks run. `boot` is called with no arguments. Read services with `this.app.make(...)` inside the method.

The starter `app/Providers/AppServiceProvider.ts` is the usual place for application-wide bindings. Its `register` method wires the session guard; its `boot` method is empty until you add work that must run after every provider is registered.

## Registering Providers

Providers are registered from `bootstrap/providers.ts`. The default file exports `registerProviders`, which receives the application:

```ts
import type { Application } from "@bunyad/core";
import AppServiceProvider from "@/Providers/AppServiceProvider.ts";
import RiakServiceProvider from "@/Providers/RiakServiceProvider.ts";

export function registerProviders(app: Application): void {
  app.register(AppServiceProvider);
  app.register(RiakServiceProvider);
}
```

`app.register` accepts the provider class. It constructs the class with the application, calls `register` immediately, and stores `boot` to run later. You can also pass a plain object with optional `register` and `boot` functions when you do not want a class:

```ts
app.register({
  register(app) {
    app.singleton(Connection, () => new Connection());
  },
});
```

`providerIsLoaded(RiakServiceProvider)` is true after `register` has been called for that class. `getLoadedProviders()` returns a map of provider names to `true`.

`registered`, `booting`, and `booted` subscribe to the boot sequence. `registered` runs each time a provider is registered. `booting` runs before provider `boot` methods. `booted` runs after them, and if you subscribe after the application has already booted, the callback runs immediately:

```ts
app.booted(() => {
  app.make(Connection).ping();
});
```
