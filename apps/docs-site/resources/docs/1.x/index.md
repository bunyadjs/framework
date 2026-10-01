---
title: Introduction
description: Bunyad is a TypeScript framework for Bun with routing, a container, and a familiar application layout.
---

# Introduction

Bunyad is a web application framework for [Bun](https://bun.sh). A framework gives you a structure and a starting point, so you can spend your time on the application instead of the plumbing around HTTP, configuration, and the database.

Bunyad aims for a direct developer experience: dependency injection, an expressive database layer, queues, scheduled work, and tests are all part of the same application. You write TypeScript. The process that serves requests is Bun.

## Why Bunyad?

There are many ways to put an HTTP server on Bun. Bunyad is the one that grows with the application. A first route can be a single function. The same app can later use controllers, form requests, sessions, queues, and a database without changing frameworks.

### A progressive framework

If you are new to Bun, the [installation](/docs/1.x/installation) guide and the directory layout are enough to get a page on screen. You do not need the container or the compiler on day one.

If you already build HTTP services, start with [routing](/docs/1.x/routing), [middleware](/docs/1.x/middleware), and [requests](/docs/1.x/requests). The names and the file layout will feel familiar if you have used a full-stack framework before.

### A framework that fits an agent

Routes, controllers, and models live in predictable places. When you ask an agent to add a controller, `app/Http/Controllers` is the directory. When you ask for a migration, `database/migrations` is the directory. That consistency is the point of the starter kits.

### Packages you can use alone

The framework is a set of `@bunyad/*` packages. The web starter kits (Views, Live, React, Vue, and Svelte) pull in sessions and authentication with a full set of auth and settings pages. The API starter leaves the view layer out. You can depend on `@bunyad/router` or `@bunyad/http` without taking the rest — see [using packages alone](/docs/1.x/standalone).

## What you will build

A Bunyad app is a folder with `routes/`, `app/`, `config/`, and `bootstrap/`. `server.ts` boots that folder and hands each request to the HTTP kernel. The [request lifecycle](/docs/1.x/lifecycle) page follows one request from Bun to your controller and back.

## Next steps

Install Bun, create an application, and open it in the browser. Then read [configuration](/docs/1.x/configuration) before you change the environment.
