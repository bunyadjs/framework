import { expect, test } from "bun:test";
import { bootApp, follow, session } from "./helpers.ts";

function counterSnapshotFromHtml(html: string) {
  const match = html.match(
    /data-live="counter"[^>]*data-snapshot="([^"]+)"/,
  );
  expect(match).toBeTruthy();
  return JSON.parse(Buffer.from(match![1]!, "base64").toString("utf8"));
}

test("livewire demo mounts nested dashboard and increments child", async () => {
  const { fetch } = await bootApp();
  const { cookie, token } = await session(fetch);

  const page = await fetch(
    new Request("http://localhost/livewire", {
      headers: { cookie },
    }),
  );
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain('data-live="dashboard"');
  expect(html).toContain('data-live="counter"');
  expect(html).toContain("/live/live.js");
  expect(html).toContain('live:navigate');
  expect(html).toContain('data-count="0"');

  const snapshot = counterSnapshotFromHtml(html);

  const update = await fetch(
    new Request("http://localhost/live/update", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        accept: "application/json",
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "counter",
        snapshot,
        calls: [{ method: "increment" }],
      }),
    }),
  );
  expect(update.status).toBe(200);
  const body = (await update.json()) as {
    html: string;
    snapshot: { data: { count: number } };
  };
  expect(body.html).toContain('data-count="1"');
  expect(body.snapshot.data.count).toBe(1);
});

test("livewire about page loads for live:navigate", async () => {
  const { fetch } = await bootApp();
  const { cookie } = await session(fetch);
  const page = await fetch(
    new Request("http://localhost/livewire/about", {
      headers: { cookie },
    }),
  );
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain("About Wire");
  expect(html).toContain("live:navigate");
});

test("pulse dashboard shows recorded livewire hits", async () => {
  const { fetch } = await bootApp();
  const { cookie } = await session(fetch);

  await fetch(
    new Request("http://localhost/livewire", { headers: { cookie } }),
  );

  const page = await fetch(
    new Request("http://localhost/pulse", { headers: { cookie } }),
  );
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain("Metrics");
  expect(html).toContain("request");
  expect(html).toContain("/livewire");

  const json = await fetch(
    new Request("http://localhost/pulse/aggregates", {
      headers: { cookie, accept: "application/json" },
    }),
  );
  expect(json.status).toBe(200);
  const body = (await json.json()) as {
    aggregates: { type: string; key: string; count: number }[];
  };
  expect(
    body.aggregates.some((r) => r.type === "request" && r.key === "/livewire"),
  ).toBe(true);
});

function notesSnapshotFromHtml(html: string) {
  const match = html.match(
    /data-live="notes"[^>]*data-snapshot="([^"]+)"/,
  );
  expect(match).toBeTruthy();
  return JSON.parse(Buffer.from(match![1]!, "base64").toString("utf8"));
}

async function signInNotes(
  fetch: (request: Request) => Promise<Response>,
  cookie: string,
  token: string,
) {
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
        email: "notes-ui@example.com",
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
        email: "notes-ui@example.com",
        password: "secret",
      }),
    }),
  );
  // Logging in regenerates the session; this is the signed-in cookie and token.
  return follow(login, { cookie, token });
}

test("notes page requires auth", async () => {
  const { fetch } = await bootApp();
  const { cookie } = await session(fetch);
  const page = await fetch(
    new Request("http://localhost/notes", {
      headers: { cookie, accept: "text/html" },
    }),
  );
  expect(page.status).toBe(302);
  expect(page.headers.get("Location")).toBe("/login");
});

test("notes livewire create update delete", async () => {
  const { fetch } = await bootApp();
  const guest = await session(fetch);
  const { cookie, token } = await signInNotes(fetch, guest.cookie, guest.token);

  const page = await fetch(
    new Request("http://localhost/notes", {
      headers: { cookie, accept: "text/html" },
    }),
  );
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain('data-live="notes"');
  expect(html).toContain("No notes yet");
  expect(html).toContain("Tags");

  let snapshot = notesSnapshotFromHtml(html);

  const created = await fetch(
    new Request("http://localhost/live/update", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        accept: "application/json",
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "notes",
        snapshot,
        updates: { title: "First note", body: "Body text", tags: "work, sse" },
        calls: [{ method: "save" }],
      }),
    }),
  );
  expect(created.status).toBe(200);
  const createdBody = (await created.json()) as {
    html: string;
    snapshot: { data: { notes: Array<{ id: string; title: string }> } };
  };
  expect(createdBody.html).toContain("First note");
  expect(createdBody.html).toContain('data-tag="work"');
  expect(createdBody.html).toContain('data-tag="sse"');
  expect(createdBody.html).toContain("Note created.");
  const id = createdBody.snapshot.data.notes[0]!.id;
  snapshot = createdBody.snapshot;

  const updated = await fetch(
    new Request("http://localhost/live/update", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        accept: "application/json",
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "notes",
        snapshot,
        calls: [{ method: "edit", params: [id] }],
      }),
    }),
  );
  snapshot = ((await updated.json()) as { snapshot: unknown }).snapshot as typeof snapshot;

  const saved = await fetch(
    new Request("http://localhost/live/update", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        accept: "application/json",
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "notes",
        snapshot,
        updates: { title: "Renamed note", body: "Body text" },
        calls: [{ method: "save" }],
      }),
    }),
  );
  const savedBody = (await saved.json()) as {
    html: string;
    snapshot: { data: { notes: Array<{ id: string }> } };
  };
  expect(savedBody.html).toContain("Renamed note");
  expect(savedBody.html).toContain("Note updated.");
  snapshot = savedBody.snapshot;

  const deleted = await fetch(
    new Request("http://localhost/live/update", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        accept: "application/json",
        "x-csrf-token": token,
      },
      body: JSON.stringify({
        name: "notes",
        snapshot,
        calls: [{ method: "remove", params: [id] }],
      }),
    }),
  );
  const deletedHtml = ((await deleted.json()) as { html: string }).html;
  expect(deletedHtml).toContain("Note deleted.");
  expect(deletedHtml).toContain("No notes yet");
});

test("notes livewire shows a teammate note in the same tenant", async () => {
  const { fetch } = await bootApp();
  const guest = await session(fetch);
  const ada = await signInNotes(fetch, guest.cookie, guest.token);

  const page = await fetch(
    new Request("http://localhost/notes", {
      headers: { cookie: ada.cookie, accept: "text/html" },
    }),
  );
  expect(page.status).toBe(200);
  const snapshot = notesSnapshotFromHtml(await page.text());

  const created = await fetch(
    new Request("http://localhost/live/update", {
      method: "POST",
      headers: {
        cookie: ada.cookie,
        "content-type": "application/json",
        accept: "application/json",
        "x-csrf-token": ada.token,
      },
      body: JSON.stringify({
        name: "notes",
        snapshot,
        updates: { title: "Ada shared this", body: "" },
        calls: [{ method: "save" }],
      }),
    }),
  );
  expect(created.status).toBe(200);
  expect(((await created.json()) as { html: string }).html).toContain(
    "Ada shared this",
  );

  const alan = await session(fetch);
  await fetch(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: alan.cookie,
        "x-csrf-token": alan.token,
      },
      body: JSON.stringify({
        name: "Alan",
        email: "notes-teammate@example.com",
        password: "secret",
      }),
    }),
  );
  const alanLogin = await fetch(
    new Request("http://localhost/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: alan.cookie,
        "x-csrf-token": alan.token,
      },
      body: JSON.stringify({
        email: "notes-teammate@example.com",
        password: "secret",
      }),
    }),
  );

  const teammatePage = await fetch(
    new Request("http://localhost/notes", {
      headers: { cookie: follow(alanLogin, alan).cookie, accept: "text/html" },
    }),
  );
  expect(teammatePage.status).toBe(200);
  expect(await teammatePage.text()).toContain("Ada shared this");
});

