---
title: Configuration
description: Environment files, config values, debug mode, and maintenance mode.
---

# Configuration

## Introduction

All of the configuration files for a Bunyad application live in the `config` directory. Each file default-exports an object. `bootstrap/app.ts` passes those objects to the application when it is created.

The values you will change per machine — the database password, the application URL, whether debug pages are on — belong in the environment. The config file reads them. Do not commit a `.env` that contains secrets.

## Environment configuration

A `.env` file next to `package.json` is loaded for you when the process starts. The starter kits' application config looks like this:

```ts title="config/app.ts"
export default {
  name: process.env.APP_NAME ?? "Bunyad",
  env: process.env.APP_ENV ?? "local",
  debug: process.env.APP_DEBUG !== "false",
  port: Number(process.env.PORT ?? 3000),
  url: process.env.APP_URL ?? "http://localhost:3000",
};
```

| Key | Environment | Default |
| --- | --- | --- |
| `name` | `APP_NAME` | `Bunyad` |
| `env` | `APP_ENV` | `local` |
| `debug` | `APP_DEBUG` | on, unless the value is `false` |
| `port` | `PORT` | `3000` |
| `url` | `APP_URL` | `http://localhost:3000` |

### Retrieving environment configuration

Read a variable with `process.env` inside a config file. Other application code should read `app.config.get(...)` so it sees the value after config has been assembled, not a second copy of the environment.

### Determining the current environment

`APP_ENV` is the current environment name. `local`, `production`, and `testing` are the names the application helpers understand.

```ts
app.environment();
app.environment("local");
app.isLocal();
app.isProduction();
```

`environment()` with no arguments returns the name. With one or more names, it returns `true` when the current environment is one of them. `runningUnitTests()` is true when the environment is `testing`, or when Bun’s test runner set `BUN_TEST`.

The environment name does not hide stack traces. Debug mode does.

## Accessing configuration values

Pass config into the application from `bootstrap/app.ts`:

```ts title="bootstrap/app.ts"
const app = new Application({
  basePath,
  config: { app: appConfig },
  router,
});
```

Read it later with `get`. The first argument is `file.key`. The second argument is the default when the key is missing.

```ts
app.config.get("app.name", "Bunyad");
app.config.get("app.url");
```

`set` writes a value for the rest of the process:

```ts
app.config.set("app.name", "Acme");
```

Add another file by exporting it from `config/` and including it in the `config` object, for example `config: { app: appConfig, database: databaseConfig }`. You then read `app.config.get("database.connection")` using the same dotted form.

## Debug mode

The `debug` option decides how much of an error the client sees. In the starter it is on unless `APP_DEBUG` is the string `false`.

When debug is on, an HTML error includes the exception class, message, stack, and a snippet of the source file. When it is off, the HTML page is still returned, but it shows only the status code and a short title. [Error handling](/docs/1.x/errors) describes both pages.

Leave debug off for any application that is reachable beyond your own machine. The debug page includes source and, for query errors, SQL.

## Maintenance mode

`app.isDownForMaintenance()` is true when `storage/framework/down` exists. Create that file to take the application down, and delete it to bring the application back. `maintenanceMode()` returns `{ active, path }` for the same check.

The HTTP kernel does not, by itself, turn that file into a 503 response. Read the flag from your own global middleware when you want every request to stop:

```ts
app.middleware([
  async (request, next) => {
    if (app.isDownForMaintenance()) {
      return new Response("Service Unavailable", { status: 503 });
    }
    return next(request);
  },
]);
```
