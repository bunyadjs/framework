import { expect, test } from "bun:test";
import { bootApp, follow, session } from "./helpers.ts";

test("GET / returns hello world json with middleware header", async () => {
  const { fetch } = await bootApp();
  const res = await fetch(
    new Request("http://localhost/", {
      headers: { Accept: "application/json" },
    }),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("X-Example")).toBe("1");
  expect(res.headers.get("X-CSRF-TOKEN")).toBeTruthy();
  expect(await res.json()).toEqual({
    message: "Hello, Bunyad",
    framework: "bunyad",
  });
});

test("GET / HTML hub lists playground links", async () => {
  const { fetch } = await bootApp();
  const res = await fetch(new Request("http://localhost/"));
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("text/html");
  const html = await res.text();
  expect(html).toContain("Bunyad Playground");
  expect(html).toContain('href="/livewire"');
  expect(html).toContain('href="/metrics"');
  expect(html).toContain('href="/inertia"');
  expect(html).toContain('href="/features"');
  expect(html).toContain('href="/databases"');
  expect(html).toContain('href="/notes"');
  expect(html).toContain('href="/login"');
  expect(html).toContain('href="/bench/hello"');
  expect(html).toContain('href="/bench/bun/hello"');
  expect(html).toContain("live:navigate");
});

test("welcome layout and session flash", async () => {
  const { fetch } = await bootApp();
  const { cookie, token } = await session(fetch);

  const created = await fetch(
    new Request("http://localhost/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({ name: "Ada", email: "ada@example.com" }),
    }),
  );
  expect(created.status).toBe(201);

  const res = await fetch(
    new Request("http://localhost/welcome", {
      headers: { cookie },
    }),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("text/html");
  const html = await res.text();
  expect(html).toContain("<h1>Welcome</h1>");
  expect(html).toContain("Created Ada");
  expect(html).toContain("ada@example.com");
  expect(html).toContain("Bunyad");
});

test("multi-database page lists users per connection", async () => {
  const { fetch } = await bootApp();
  const { cookie, token } = await session(fetch);

  const created = await fetch(
    new Request("http://localhost/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({ name: "Primary Ada", email: "ada@primary.test" }),
    }),
  );
  expect(created.status).toBe(201);

  const primary = await fetch(new Request("http://localhost/databases"));
  expect(primary.status).toBe(200);
  const primaryHtml = await primary.text();
  expect(primaryHtml).toContain("Multiple databases");
  expect(primaryHtml).toContain("Active connection: <code>default</code>");
  expect(primaryHtml).toContain("Primary Ada");
  expect(primaryHtml).toContain("ada@primary.test");
  expect(primaryHtml).not.toContain("Secondary Ada");

  const secondary = await fetch(
    new Request("http://localhost/databases?connection=secondary"),
  );
  expect(secondary.status).toBe(200);
  const secondaryHtml = await secondary.text();
  expect(secondaryHtml).toContain("Active connection: <code>secondary</code>");
  expect(secondaryHtml).toContain("Secondary Ada");
  expect(secondaryHtml).toContain("ada@secondary.test");
  expect(secondaryHtml).toContain("Secondary Bob");
  expect(secondaryHtml).not.toContain("Primary Ada");
  expect(secondaryHtml).not.toContain("ada@primary.test");
});

test("Inertia auth login page", async () => {
  const { fetch } = await bootApp();
  const res = await fetch(
    new Request("http://localhost/login", {
      headers: { Accept: "text/html" },
    }),
  );
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html.replace(/\\\//g, "/")).toContain("Auth/Login");
  expect(html).toContain("/build/app.js");
  expect(html).toContain("/build/app.css");

  const jsonRes = await fetch(
    new Request("http://localhost/login", {
      headers: {
        "X-Inertia": "true",
        "X-Inertia-Version": "1",
        Accept: "text/html, application/xhtml+xml",
      },
    }),
  );
  expect(jsonRes.status).toBe(200);
  const page = (await jsonRes.json()) as { component: string };
  expect(page.component).toBe("Auth/Login");
});

test("Inertia first visit HTML and X-Inertia JSON", async () => {
  const { fetch } = await bootApp();

  const htmlRes = await fetch(new Request("http://localhost/inertia"));
  expect(htmlRes.status).toBe(200);
  expect(htmlRes.headers.get("Content-Type")).toContain("text/html");
  const html = await htmlRes.text();
  expect(html).toContain('id="app"');
  expect(html).toContain("Welcome");
  expect(html).toContain("Hello from Bunyad");
  expect(html).toContain("Bunyad");

  const jsonRes = await fetch(
    new Request("http://localhost/inertia", {
      headers: {
        "X-Inertia": "true",
        "X-Inertia-Version": "1",
      },
    }),
  );
  expect(jsonRes.status).toBe(200);
  expect(jsonRes.headers.get("X-Inertia")).toBe("true");
  const page = (await jsonRes.json()) as {
    component: string;
    props: Record<string, unknown>;
    version: string;
  };
  expect(page.component).toBe("Welcome");
  expect(page.version).toBe("1");
  expect(page.props.title).toBe("Inertia");
  expect(page.props.appName).toBe("Bunyad");
});

test("users and posts with validation", async () => {
  const { fetch } = await bootApp();
  const { cookie, token } = await session(fetch);

  const invalid = await fetch(
    new Request("http://localhost/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({ name: "A", email: "bad" }),
    }),
  );
  expect(invalid.status).toBe(422);

  const created = await fetch(
    new Request("http://localhost/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({ name: "Ada", email: "ada@example.com" }),
    }),
  );
  expect(created.status).toBe(201);
  const user = (await created.json()) as {
    data: { id: number; name: string; email: string };
  };

  const postRes = await fetch(
    new Request("http://localhost/posts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({ user_id: user.data.id, title: "Hello world" }),
    }),
  );
  expect(postRes.status).toBe(201);

  const posts = await fetch(
    new Request(`http://localhost/users/${user.data.id}/posts`),
  );
  expect(
    ((await posts.json()) as { data: unknown[] }).data,
  ).toHaveLength(1);

  const missing = await fetch(new Request("http://localhost/posts/999"));
  expect(missing.status).toBe(404);
});

test("login protects dashboard", async () => {
  const { fetch } = await bootApp();
  let { cookie, token } = await session(fetch);

  const guest = await fetch(
    new Request("http://localhost/dashboard", {
      headers: { accept: "text/html", cookie },
    }),
  );
  expect(guest.status).toBe(302);
  expect(guest.headers.get("Location")).toBe("/login");

  const registered = await fetch(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "Ada",
        email: "ada@example.com",
        password: "secret",
      }),
    }),
  );
  expect(registered.status).toBe(302);

  const login = await fetch(
    new Request("http://localhost/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({ email: "ada@example.com", password: "secret" }),
    }),
  );
  expect(login.status).toBe(302);
  expect(login.headers.get("Location")).toBe("/dashboard");

  // Logging in regenerates the session: carry the new cookie on, as a browser does.
  ({ cookie, token } = follow(login, { cookie, token }));

  const dash = await fetch(
    new Request("http://localhost/dashboard", {
      headers: { accept: "text/html", cookie },
    }),
  );
  expect(dash.status).toBe(200);
  const dashHtml = await dash.text();
  expect(dashHtml.replace(/\\\//g, "/")).toContain("Auth/Dashboard");
  expect(dashHtml).toContain('"name":"Ada"');
  expect(dashHtml).toContain("/build/app.js");
});

test("post policy allows owner delete only", async () => {
  const { fetch } = await bootApp();
  let { cookie, token } = await session(fetch);

  await fetch(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "Ada",
        email: "ada@example.com",
        password: "secret",
      }),
    }),
  );
  const login = await fetch(
    new Request("http://localhost/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({ email: "ada@example.com", password: "secret" }),
    }),
  );

  ({ cookie, token } = follow(login, { cookie, token }));

  const userRes = await fetch(new Request("http://localhost/users"));
  const { data: users } = (await userRes.json()) as {
    data: Array<{ id: number; name: string; email: string }>;
  };
  const ada = users[0]!;

  const postRes = await fetch(
    new Request("http://localhost/posts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({ user_id: ada.id, title: "Owned post" }),
    }),
  );
  const post = (await postRes.json()) as { id: number };

  let other = await session(fetch);
  await fetch(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: other.cookie,
        "x-csrf-token": other.token,
      },
      body: JSON.stringify({
        name: "Bob",
        email: "bob@example.com",
        password: "secret",
      }),
    }),
  );
  const otherLogin = await fetch(
    new Request("http://localhost/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: other.cookie,
        "x-csrf-token": other.token,
      },
      body: JSON.stringify({ email: "bob@example.com", password: "secret" }),
    }),
  );

  other = follow(otherLogin, other);

  const forbidden = await fetch(
    new Request(`http://localhost/posts/${post.id}`, {
      method: "DELETE",
      headers: { cookie: other.cookie, "x-csrf-token": other.token },
    }),
  );
  expect(forbidden.status).toBe(403);

  const deleted = await fetch(
    new Request(`http://localhost/posts/${post.id}`, {
      method: "DELETE",
      headers: { cookie, "x-csrf-token": token },
    }),
  );
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toEqual({ deleted: true });
});

test("api token guard issues bearer tokens", async () => {
  const { fetch } = await bootApp();
  const { cookie, token } = await session(fetch);

  await fetch(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "Ada",
        email: "ada@example.com",
        password: "secret",
      }),
    }),
  );

  const issued = await fetch(
    new Request("http://localhost/api/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "ada@example.com",
        password: "secret",
        name: "test",
      }),
    }),
  );
  expect(issued.status).toBe(200);
  const body = (await issued.json()) as {
    token: string;
    token_type: string;
    user: { email: string };
  };
  expect(body.token_type).toBe("Bearer");
  expect(body.user.email).toBe("ada@example.com");

  const me = await fetch(
    new Request("http://localhost/api/me", {
      headers: { authorization: `Bearer ${body.token}` },
    }),
  );
  expect(me.status).toBe(200);
  expect(((await me.json()) as { data: { name: string } }).data.name).toBe("Ada");

  const revoked = await fetch(
    new Request("http://localhost/api/token", {
      method: "DELETE",
      headers: { authorization: `Bearer ${body.token}` },
    }),
  );
  expect(revoked.status).toBe(200);

  const denied = await fetch(
    new Request("http://localhost/api/me", {
      headers: {
        authorization: `Bearer ${body.token}`,
        accept: "application/json",
      },
    }),
  );
  expect(denied.status).toBe(401);
});

test("authenticated notes create and list", async () => {
  const { fetch } = await bootApp();
  const { cookie, token } = await session(fetch);

  await fetch(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "Ada",
        email: "notes@example.com",
        password: "secret",
      }),
    }),
  );

  const issued = await fetch(
    new Request("http://localhost/api/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "notes@example.com",
        password: "secret",
        name: "notes",
      }),
    }),
  );
  const { token: bearer } = (await issued.json()) as { token: string };

  const created = await fetch(
    new Request("http://localhost/api/notes", {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "From API" }),
    }),
  );
  expect(created.status).toBe(201);
  const note = (await created.json()) as { id: string; title: string };
  expect(note.title).toBe("From API");
  expect(typeof note.id).toBe("string");

  const listed = await fetch(
    new Request("http://localhost/api/notes", {
      headers: { authorization: `Bearer ${bearer}` },
    }),
  );
  expect(listed.status).toBe(200);
  const body = (await listed.json()) as { notes: Array<{ title: string }> };
  expect(body.notes.some((row) => row.title === "From API")).toBe(true);

  const patched = await fetch(
    new Request(`http://localhost/api/notes/${note.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Updated API", body: "Hello" }),
    }),
  );
  expect(patched.status).toBe(200);
  expect(((await patched.json()) as { title: string }).title).toBe("Updated API");

  const removed = await fetch(
    new Request(`http://localhost/api/notes/${note.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${bearer}` },
    }),
  );
  expect(removed.status).toBe(200);
  const after = await fetch(
    new Request("http://localhost/api/notes", {
      headers: { authorization: `Bearer ${bearer}` },
    }),
  );
  expect(
    ((await after.json()) as { notes: Array<{ id: string }> }).notes,
  ).toEqual([]);
});

test("notifications inbox and mark read", async () => {
  const { fetch } = await bootApp({ broadcastDriver: "sync" });
  const { cookie, token } = await session(fetch);

  await fetch(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "Ada",
        email: "ada@example.com",
        password: "secret",
      }),
    }),
  );

  const issued = await fetch(
    new Request("http://localhost/api/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "ada@example.com",
        password: "secret",
      }),
    }),
  );
  const { token: bearer } = (await issued.json()) as { token: string };

  const list = await fetch(
    new Request("http://localhost/api/notifications", {
      headers: { authorization: `Bearer ${bearer}` },
    }),
  );
  expect(list.status).toBe(200);
  const inbox = (await list.json()) as {
    data: Array<{ id: string; data: { message: string } }>;
    meta: { unread: number };
  };
  expect(inbox.meta.unread).toBe(1);
  expect(inbox.data[0]!.data.message).toContain("ada@example.com");

  const read = await fetch(
    new Request(`http://localhost/api/notifications/${inbox.data[0]!.id}/read`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}` },
    }),
  );
  expect(read.status).toBe(200);

  const again = await fetch(
    new Request("http://localhost/api/notifications", {
      headers: { authorization: `Bearer ${bearer}` },
    }),
  );
  expect(
    ((await again.json()) as { meta: { unread: number } }).meta.unread,
  ).toBe(0);
});

test("sse broadcasting endpoint streams", async () => {
  const { fetch } = await bootApp({ broadcastDriver: "sse" });

  const missing = await fetch(
    new Request("http://localhost/api/broadcasting/sse"),
  );
  expect(missing.status).toBe(422);

  const stream = await fetch(
    new Request("http://localhost/api/broadcasting/sse?channel=users"),
  );
  expect(stream.status).toBe(200);
  expect(stream.headers.get("Content-Type")).toContain("text/event-stream");
  await stream.body?.cancel();
});

test("private channel auth and sse guard", async () => {
  const { fetch } = await bootApp({ broadcastDriver: "sse" });
  const { cookie, token } = await session(fetch);

  await fetch(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "Ada",
        email: "ada@example.com",
        password: "secret",
      }),
    }),
  );

  const issued = await fetch(
    new Request("http://localhost/api/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "ada@example.com",
        password: "secret",
      }),
    }),
  );
  const { token: bearer } = (await issued.json()) as { token: string };

  const forbidden = await fetch(
    new Request("http://localhost/api/broadcasting/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel_name: "private-user.1" }),
    }),
  );
  expect(forbidden.status).toBe(403);

  const allowed = await fetch(
    new Request("http://localhost/api/broadcasting/auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ channel_name: "private-user.1" }),
    }),
  );
  expect(allowed.status).toBe(200);
  expect(((await allowed.json()) as { auth: boolean }).auth).toBe(true);

  const privateSse = await fetch(
    new Request("http://localhost/api/broadcasting/sse?channel=private-user.1", {
      headers: { authorization: `Bearer ${bearer}` },
    }),
  );
  expect(privateSse.status).toBe(200);
  await privateSse.body?.cancel();

  const deniedSse = await fetch(
    new Request("http://localhost/api/broadcasting/sse?channel=private-user.1"),
  );
  expect(deniedSse.status).toBe(403);

  const presenceAuth = await fetch(
    new Request("http://localhost/api/broadcasting/auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ channel_name: "presence-chat" }),
    }),
  );
  expect(presenceAuth.status).toBe(200);
  const presenceBody = (await presenceAuth.json()) as {
    channel_data: { user_info: { name: string } };
    members: unknown[];
  };
  expect(presenceBody.channel_data.user_info.name).toBe("Ada");

  const presenceSse = await fetch(
    new Request("http://localhost/api/broadcasting/sse?channel=presence-chat", {
      headers: { authorization: `Bearer ${bearer}` },
    }),
  );
  expect(presenceSse.status).toBe(200);
  await presenceSse.body?.cancel();
});

test("horizon dashboard stats for admin", async () => {
  const { fetch } = await bootApp();
  let { cookie, token } = await session(fetch);

  await fetch(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "Ada",
        email: "ada@example.com",
        password: "secret",
      }),
    }),
  );

  const login = await fetch(
    new Request("http://localhost/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        email: "ada@example.com",
        password: "secret",
      }),
    }),
  );
  expect(login.status).toBe(302);

  ({ cookie, token } = follow(login, { cookie, token }));

  const stats = await fetch(
    new Request("http://localhost/horizon/api/stats", { headers: { cookie } }),
  );
  expect(stats.status).toBe(200);
  const body = (await stats.json()) as {
    pending: number;
    failed: unknown[];
  };
  expect(body.pending).toBe(0);
  expect(Array.isArray(body.failed)).toBe(true);

  const page = await fetch(
    new Request("http://localhost/horizon", { headers: { cookie } }),
  );
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("Horizon");
});
