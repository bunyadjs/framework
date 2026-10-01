---
title: Error Handling
description: Debug pages, reporting, custom renderers, HTTP exceptions, and validation failures.
---

# Error Handling

## Introduction

Thrown errors become HTTP responses. The kernel renders them, so the process stays up and the client receives a status code instead of a dropped connection.

## Configuration

Two settings are involved. `APP_ENV` is the environment name (`local`, `production`, `testing`). `APP_DEBUG` decides how much of the error the response includes.

```env
APP_ENV=local
APP_DEBUG=true
```

The starter treats debug as on unless `APP_DEBUG` is the string `false`:

```ts title="config/app.ts"
debug: process.env.APP_DEBUG !== "false",
```

`APP_ENV=production` does not hide the stack. Set `APP_DEBUG=false` on any machine that should not show source. `app.hasDebugModeEnabled()` reads the same flag after the application has booted.

## Handling exceptions

### Reporting exceptions

Status codes 500 and above are reported by default. Client errors such as 404 and 422 are rendered and are not reported as server failures. Configure reporting in `bootstrap/app.ts`:

```ts
await Application.configure(import.meta.dir)
  .withExceptions((exceptions) => {
    exceptions.dontReport([PaymentIgnoredError]);
    exceptions.reportable((error) => {
      if (error instanceof TransientError) return false;
    });
    exceptions.context((error) => ({
      orderId: error instanceof OrderError ? error.orderId : undefined,
    }));
    exceptions.dontFlash(["ssn", "card_number"]);
  })
  .create();
```

| Method | Role |
| --- | --- |
| `dontReport` | Exception classes that are never reported |
| `reportable` | Callback — return `false` to skip, `true` to force |
| `context` | Extra fields printed when reporting |
| `dontFlash` | Extra input keys stripped (with `password` / `_token`) on validation redirects |

`report` from `@bunyad/common` is what the renderer calls for those server errors. Call it yourself when you catch an exception and still want it recorded:

```ts
import { report } from "@bunyad/common";

try {
  await billCustomer();
} catch (error) {
  report(error);
}
```

### Rendering exceptions

The default renderer picks HTML or JSON.

HTML, with debug on, is a page with the exception class, the message, the stack, and a snippet of the file that threw. Query failures include the SQL. The environment name from `app.env` is printed on that page.

HTML, with debug off, is still a page. It shows the status code and a short title: “Not Found” for 404, and “Server Error” for every other status. The application name is on the page. The message, stack, file paths, and SQL are not.

```env
APP_DEBUG=false
```

JSON, with debug on, includes the message, the exception name, the file, the line, and the stack. JSON query failures with debug off are `"Server Error"`. Other JSON errors still include `error.message`, without the stack or the SQL.

A request [expects JSON](/docs/1.x/requests) when `Accept` prefers JSON, or when it is an AJAX request that accepts any type. Replace that rule with `shouldRenderJsonWhen` if one client should always receive JSON:

```ts
app.shouldRenderJsonWhen((request) => request.path().startsWith("api"));
```

### Your own renderer

`renderUsing` registers a renderer. Return a `Response` to take over. Return nothing and the next renderer runs. When none of them return a response, the default page runs.

```ts
app.renderUsing((error, request) => {
  if (error instanceof Error && error.message === "maintenance") {
    return new Response("Down", { status: 503 });
  }
});
```

Renderers run in the order you registered them.

## HTTP exceptions

`abort` throws an HTTP exception with the status you pass. The kernel turns it into the error page for that status.

```ts
import { abort, abort_if, abort_unless } from "@bunyad/http";

abort(404);
abort(403, "You cannot view this order.");
abort_if(!user, 404);
abort_unless(user.isAdmin, 403);
```

The third argument of `abort` is a header map, for example a `WWW-Authenticate` header on a 401.

A route that matches nothing is a 404 from the kernel. `Route.fallback` is how you replace that response. See [routing](/docs/1.x/routing).

### Validation exceptions

A failed form request is not the debug page. When the client accepts HTML and a session is open, the kernel flashes `errors` and `_old` and redirects to the previous URL. The password is removed from the old input. A JSON client receives 422:

```json
{
  "message": "The given data was invalid.",
  "errors": { "email": ["The email field is required."] }
}
```

`message` is the validator’s summary. `errors` is the field bag.

:::warning
Leave `APP_DEBUG` off for any app that is reachable beyond your machine. The debug page includes source and, for query errors, SQL.
:::
