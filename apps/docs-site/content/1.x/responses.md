---
title: Responses
description: Strings, JSON, headers, cookies, redirects, files, and streamed responses.
---

# Responses

## Introduction

A route returns a value, and the kernel turns it into an HTTP response.

| Return value | What the client receives |
| --- | --- |
| `Response` | That response, unchanged |
| String | HTML, status 200, `Content-Type: text/html` |
| Number or boolean | The value printed as HTML |
| `null` or `undefined` | An empty HTML body |
| Plain object or array | JSON |
| Object with `toJSON()` | JSON, using `toJSON()` |
| Object with `toResponse(request)` | Whatever that method returns |

Anything else throws. The action must return a response, a string, or a JSON value.

```ts
import { json, redirect, response } from "@bunyad/http";
import { view } from "@bunyad/view";

Route.get("/users", () => json({ users: [] }));
Route.get("/home", () => redirect("/dashboard"));
Route.get("/hello", () => view("greeting", { name: "James" }));
```

`response` is both a function and a factory. `response(body, init)` builds a Fetch `Response`. `response()` with no arguments is the factory: `response().json()`, `response().noContent()`, `response().file()`, `response().download()`, `response().stream()`, `response().streamJson()`, `response().eventStream()`, `response().streamDownload()`, and `response().redirect()`.

## Creating responses

The shortest response is a string. The kernel wraps it in an HTML response.

```ts
Route.get("/", () => "Hello World");
```

Pass a status and headers when the string helper is not enough:

```ts
import { response } from "@bunyad/http";

Route.get("/", () =>
  response("Hello World", { status: 200, headers: { "Content-Type": "text/plain" } }),
);
```

`HttpResponse.from(content, status)` is the fluent builder. Call `toFetch()` before returning it. The kernel does not accept the builder on its own.

```ts
import { HttpResponse } from "@bunyad/http";

Route.get("/profile", () =>
  HttpResponse.from("<h1>Profile</h1>", 200).toFetch(),
);
```

`noContent()` sends an empty body. The default status is 204.

```ts
import { noContent } from "@bunyad/http";

Route.delete("/users/{id}", () => noContent());
```

### Attaching headers

On the fluent builder, `header(name, value)` sets one header and returns the builder. `header(name)` with no value reads it back. `withHeaders` sets many. `withoutHeader` deletes one.

```ts
return HttpResponse.from("<h1>Hello</h1>")
  .header("Content-Type", "text/html; charset=utf-8")
  .withHeaders({ "X-Header-One": "Value", "X-Header-Two": "Value" })
  .toFetch();
```

On a Fetch `Response`, set headers with the `headers` option or with `response.headers.set` before you return it. A `Response` body can be read once, so prefer setting headers before the response is sent.

### Attaching cookies

`withCookie` and `cookie` append a `Set-Cookie` header. Application cookie values are encrypted with `APP_KEY` unless the name is on the except list. Defaults excepted: `bunyad_session` (session id — the bag is encrypted in the store) and `XSRF-TOKEN` (encrypted separately by CSRF middleware). `withCookies` sets several names to string values with the same options. `withoutCookie` expires the cookie by setting `Max-Age=0` and `Path=/`.

```ts
import {
  setEncryptedCookieExcept,
  addEncryptedCookieExcept,
} from "@bunyad/http";

addEncryptedCookieExcept("my_plain_cookie");
// or replace the list:
setEncryptedCookieExcept(["bunyad_session", "XSRF-TOKEN", "my_plain_cookie"]);

return HttpResponse.from("Hello")
  .withCookie("name", "value", {
    path: "/",
    domain: "example.com",
    maxAge: 60 * 60,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  })
  .toFetch();
```

Pass `encrypt: false` on a single cookie to skip encryption for that write.

`request.cookie(name)` decrypts encrypted cookies automatically.

### Response macros

Register macros on `Response` / `response` so apps can add fluent helpers at boot:

```ts
import { Response, response } from "@bunyad/http";

Response.macro("caps", function (value: string) {
  return this.setContent(value.toUpperCase());
});

// later
return response().caps("hello").toFetch();
```

`Response.mixin({ … })` registers several macros at once.

`sameSite` is `Strict`, `Lax`, or `None`. The session cookie is separate: `startSession` writes `bunyad_session` itself. Do not rebuild that cookie with `withCookie` unless you are replacing the session middleware.

## Redirects

`redirect(path)` returns a 302 with a `Location` header. The path is left as-is when it starts with `/` or `http`. Any other path gets a leading slash. Pass a status for a permanent redirect, and a headers object when the redirect needs more than `Location`.

```ts
import { redirect } from "@bunyad/http";

Route.get("/dashboard", () => redirect("/home/dashboard"));
Route.get("/old", () => redirect("/new", 301));
```

`redirect()` with no path returns a `Redirector`:

| Call | Location |
| --- | --- |
| `to(path, status, headers)` | The path, with the same rules as `redirect(path)` |
| `away(url, status, headers)` | The URL exactly as given, including an external host |
| `secure(path)` | The path with `http:` rewritten to `https:` |
| `back(status, headers, fallback)` | Previous URL, then `Referer`, then the fallback |
| `refresh()` | The current request URI |
| `home()` | `/` |
| `route(name, params, status, headers)` | The named route |
| `action([Controller, method], params, status, headers)` | The controller action |

`back()` needs the session. The session middleware stores `_previous.url` and the redirector reads it. The default fallback is `/`. Pass a path when `/` is the wrong place to land:

```ts
return redirect().back(302, {}, "/dashboard");
```

### Redirecting to named routes

```ts
return redirect().route("login");
return redirect().route("profile", { id: 1 });
```

`to_route(name, params, status, headers)` is the same call without the redirector.

```ts
import { to_route } from "@bunyad/http";

return to_route("profile", { id: user.id });
```

Named routes and `action()` need the router URL generator. A full application boots that generator. A tiny app that never loads the router gets an error from `route()` and `action()` telling you the generator is missing.

```ts
import UserController from "@/Http/Controllers/UserController.ts";

return redirect().action([UserController, "index"]);
return redirect().action([UserController, "show"], { id: 1 });
```

### Redirecting to external domains

`away` does not rewrite the URL. Use it for another site.

```ts
return redirect().away("https://example.com");
```

### Redirecting to the intended URL

When the `auth` middleware sends a guest to login, it stores the full request URL as `url.intended`. After a successful login, send them back:

```ts
return redirect().intended("/dashboard");
```

The stored URL is pulled (and cleared) from the session. When it is missing, the default path is used.

### Redirecting with flashed session data

Chain flash helpers on the redirect response. They write to the current request session immediately (the same keys validation already uses):

```ts
return redirect("/profile").with("status", "Profile updated.");

return redirect().back().withInput().withErrors({
  email: ["The email field is required."],
});
```

| Method | Session key |
| --- | --- |
| `with(key, value)` / `with({ ... })` | Each key flashed for the next request |
| `withInput()` / `withInput(data)` | `_old` (password fields stripped) |
| `withErrors(errors)` | `errors` |

You can still flash manually, then redirect:

```ts
request.session?.flash("status", "Profile updated.");
return redirect("/profile");
```

Read old input in the next view with `old('email')`. See [Session](/docs/1.x/session).

## Other response types

### View responses

`view(name, data, status)` from `@bunyad/view` returns an HTML response. The status defaults to 200.

```ts
import { view } from "@bunyad/view";

return view("users.show", { user }, 200);
```

### JSON responses

`json(data, status, headers?)` stringifies the value and sets `Content-Type` to `application/json`. The default status is 200. An optional third argument merges extra response headers. Returning a plain object from the action does the same at status 200, so use `json` when the status is anything else or when you want the call to be obvious.

```ts
import { json } from "@bunyad/http";

return json({ name: "Ada" });
return json({ created: true }, 201);
return json({ ok: true }, 200, { "X-Custom": "1" });
```

`HttpResponse.from().morphToJson(data)` replaces the body with JSON and sets the content type, then you still call `toFetch()`.

### File downloads

`download(path, name)` sends a file as an attachment. The filename defaults to the file's basename. The content type comes from the file when you do not set one.

```ts
import { download } from "@bunyad/http";

return download("storage/app/report.pdf", "quarter.pdf");
```

### File responses

`file(path)` sends the file inline, without `Content-Disposition: attachment`.

```ts
import { file } from "@bunyad/http";

return file("storage/app/photo.jpg");
```

Both helpers read the file with `Bun.file`.

## Streamed responses

`stream(callback, headers, status)` sends a body as chunks. The callback receives `write`. It may be async. The default content type is `text/plain; charset=utf-8`. The default status is 200.

```ts
import { stream } from "@bunyad/http";

Route.get("/log", () =>
  stream(async (write) => {
    write("started\n");
    write("finished\n");
  }),
);
```

A throw inside the callback errors the stream.

### Consuming a stream

The body is a `ReadableStream`. A client reads it with `response.body.getReader()` or `response.text()` when the stream has finished.

```ts
const response = await fetch("/log");
const reader = response.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}
```

### Streamed JSON

`streamJson` writes one JSON value per line and sets `Content-Type` to `application/x-ndjson`. Pass an array, a sync iterable, an async iterable, or a function that returns one.

```ts
import { streamJson } from "@bunyad/http";

return streamJson([{ id: 1 }, { id: 2 }]);

return streamJson(async function* () {
  yield { id: 1 };
  yield { id: 2 };
});
```

### Event streams

`eventStream(callback, headers, status)` writes server-sent events. `send(data, event, id)` formats one event. Objects are JSON-encoded. Strings are written as the data payload. The response sets `text/event-stream`, `Cache-Control: no-cache`, and `Connection: keep-alive`.

```ts
import { eventStream } from "@bunyad/http";

return eventStream((send) => {
  send({ ok: true }, "ready", "1");
});
```

### Streamed downloads

`streamDownload(callback, name, headers, status)` is `stream` with `Content-Disposition: attachment` and a default content type of `application/octet-stream`.

```ts
import { streamDownload } from "@bunyad/http";

return streamDownload((write) => {
  write("col1,col2\n");
  write("a,b\n");
}, "export.csv");
```

## Aborting the request

`abort(status, message, headers)` throws `HttpException`. The [error renderer](/docs/1.x/errors) turns it into the status page or a JSON body. `abort_if(condition, status, message)` throws when the condition is truthy. `abort_unless(condition, status, message)` throws when it is not.

```ts
import { abort, abort_unless } from "@bunyad/http";

abort_unless(user, 404);
abort(403, "This action is unauthorized.");
```

The message is shown when debug is on. When debug is off, an HTML 404 still says "Not Found" and every other HTML status says "Server Error", without the message.
