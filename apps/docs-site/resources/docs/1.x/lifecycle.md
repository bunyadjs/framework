---
title: Request Lifecycle
description: How a request moves from Bun through providers, middleware, and the router to a response.
---

# Request Lifecycle

## Introduction

You will trust the framework more once you can see the path a request takes. This page is that path, from the process entry to the response. If a term is new, keep going. The other pages define routing, middleware, and providers on their own.

## Lifecycle overview

### First steps

`server.ts` is the entry point. Bun accepts the connection and calls the handler installed by `serve`. That file does not contain your routes. It builds the application once:

```ts title="server.ts"
import { serve } from "@bunyad/core";
import { createApplication } from "./bootstrap/app.ts";

const app = await createApplication();
serve(app);
```

`createApplication()` in `bootstrap/app.ts` constructs the application, which is also the service container. That object lives for the life of the process. A request does not construct it again.

### HTTP kernel

`serve` hands every request to the HTTP kernel. The kernel’s `handle` method receives the Fetch API request and returns a `Response`. Think of it as the box that is your application: requests go in, responses come out.

Before the route runs, the kernel passes the request through the global middleware stack, then the middleware assigned to the matched route. Session, CSRF, and authentication belong in that stack. [Middleware](/docs/1.x/middleware) is the full description.

If the action throws, the kernel catches the error and renders a response. The process stays up. [Error handling](/docs/1.x/errors) describes that page.

### Service providers

Booting the application loads service providers. Framework providers register the pieces the starter needs, such as the view engine or the database, depending on which starter you created. Your providers are registered from `bootstrap/providers.ts`.

Each provider is constructed, then `register` runs on all of them, then `boot`. `boot` can rely on every binding from `register` already existing. `app/Providers/AppServiceProvider.ts` is the provider the starter kits ship. It is the right place for bindings that belong to this application. Framework providers boot before yours, so something you set in your `boot()` (a password broker, an email-verification sender) replaces the framework's default.

The list of your providers is the array in `bootstrap/providers.ts`. The framework’s own providers are registered by `bootFrameworkProviders` before that list runs.

### Routing

After providers boot, `bootstrap/app.ts` loads `routes/web.ts`. That happens once, not on each request. The router then matches the request, runs route middleware, and calls the closure or controller.

Middleware can stop the request. An `auth` middleware redirects a guest to the login page and never calls the controller. If every middleware calls `next`, the action runs and its return value becomes the response. A string, a plain object, a model, or a `Response` are all accepted. The kernel turns the first three into a response.

The response then walks back out through the middleware, so a middleware can change headers on the way out.

### Finishing up

When the response is finished, the kernel forgets request-scoped container instances. The next request does not see objects resolved for the previous one. Bun keeps the process alive, so the route table and the providers stay warm.

## Focus on service providers

Providers are the bootstrap. The application is created, providers register and boot, and the request is handed to that booted application.

`AppServiceProvider` starts empty. Add bindings there. Split a large application into more than one provider when one class is registering unrelated services, and register each of them from `bootstrap/providers.ts`.
