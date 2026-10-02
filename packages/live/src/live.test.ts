import { expect, test, beforeEach } from "bun:test";
import {
  Live,
  LiveComponent,
  assertSnapshot,
  makeSnapshot,
  encodeSnapshotAttribute,
  decodeSnapshotAttribute,
  clearLiveComponents,
  clientScript,
  checksumFor,
} from "../src/index.ts";

beforeEach(() => {
  clearLiveComponents();
});

class Counter extends LiveComponent {
  count = 0;

  increment() {
    this.count += 1;
  }

  add(n: number) {
    this.count += n;
  }

  html() {
    return `<span data-count="${this.count}">${this.count}</span><button type="button" data-action="increment">+</button>`;
  }
}

class Greeter extends LiveComponent {
  name = "";

  html() {
    return `<input data-model="name" value="${this.name}" /><p>${this.name}</p>`;
  }
}

function snapshotFromHtml(html: string) {
  const match = html.match(/data-snapshot="([^"]+)"/);
  expect(match).toBeTruthy();
  return JSON.parse(Buffer.from(match![1]!, "base64").toString("utf8"));
}

test("mount renders wrapped html with signed snapshot", async () => {
  Live.component("counter", Counter);
  const html = await Live.mount("counter");
  expect(html).toContain('data-live="counter"');
  expect(html).toContain('data-count="0"');
  expect(html).toContain("data-snapshot=");
  const snapshot = snapshotFromHtml(html);
  assertSnapshot(snapshot);
  expect(snapshot.data.count).toBe(0);
});

test("update runs actions and returns new html", async () => {
  Live.component("counter", Counter);
  const mounted = await Live.mount("counter");
  const snapshot = snapshotFromHtml(mounted);

  const result = await Live.update({
    name: "counter",
    snapshot,
    calls: [{ method: "increment" }],
  });
  expect(result.html).toContain('data-count="1"');
  expect(result.snapshot.data.count).toBe(1);
  assertSnapshot(result.snapshot);
});

test("update applies data-model style property updates", async () => {
  Live.component("greeter", Greeter);
  const html = await Live.mount("greeter");
  const snapshot = snapshotFromHtml(html);

  const result = await Live.update({
    name: "greeter",
    snapshot,
    updates: { name: "Ada" },
  });
  expect(result.html).toContain("Ada");
  expect(result.snapshot.data.name).toBe("Ada");
});

test("rejects tampered snapshot", async () => {
  Live.component("counter", Counter);
  const snapshot = makeSnapshot("counter", { count: 0 });
  snapshot.data.count = 99;
  await expect(
    Live.update({
      name: "counter",
      snapshot,
      calls: [{ method: "increment" }],
    }),
  ).rejects.toThrow(/checksum/);
});

test("rejects private method calls", async () => {
  Live.component("counter", Counter);
  const snapshot = makeSnapshot("counter", { count: 0 });
  await expect(
    Live.update({
      name: "counter",
      snapshot,
      calls: [{ method: "html" }],
    }),
  ).rejects.toThrow(/not callable/);
});

test("action with params", async () => {
  Live.component("counter", Counter);
  const snapshot = makeSnapshot("counter", { count: 1 });
  const result = await Live.update({
    name: "counter",
    snapshot,
    calls: [{ method: "add", params: [4] }],
  });
  expect(result.snapshot.data.count).toBe(5);
});

test("updating/updated lifecycle hooks fire on fill", async () => {
  const log: string[] = [];

  class Tracked extends LiveComponent {
    name = "";

    updating(property: string, value: unknown) {
      log.push(`updating:${property}:${value}`);
    }

    updatedName(value: unknown) {
      log.push(`updatedName:${value}`);
    }

    html() {
      return `<p>${this.name}</p>`;
    }
  }

  Live.component("tracked", Tracked);
  const snapshot = makeSnapshot("tracked", { name: "" });
  await Live.update({
    name: "tracked",
    snapshot,
    updates: { name: "Ada" },
  });
  expect(log).toEqual(["updating:name:Ada", "updatedName:Ada"]);
});

test("utf-8 snapshot round-trips through the browser decoder (not latin-1 atob)", async () => {
  class Status extends LiveComponent {
    syncLine = "Sync: 0 pending · last pull never";
    html() {
      return `<p>${this.syncLine}</p>`;
    }
  }
  Live.component("status", Status);
  const html = await Live.mount("status");
  const encoded = html.match(/data-snapshot="([^"]+)"/)![1]!;
  const latin1 = Buffer.from(encoded, "base64").toString("latin1");
  const corrupted = JSON.parse(latin1);
  expect(() => assertSnapshot(corrupted)).toThrow(/checksum/);
  const snapshot = decodeSnapshotAttribute(encoded);
  assertSnapshot(snapshot);
  expect(snapshot.data.syncLine).toContain("·");
  expect(encodeSnapshotAttribute(snapshot)).toBe(encoded);
});

test("clientScript includes action params lazy debounce and loading", () => {
  const script = clientScript("/live/update");
  expect(script).toContain("utf8FromBase64");
  expect(script).toContain("TextDecoder");
  expect(script).toContain("data-action");
  expect(script).toContain("data-model");
  expect(script).toContain("data-model.lazy");
  expect(script).toContain("debounce");
  expect(script).toContain("data-loading");
  expect(script).toContain("parseAction");
  expect(script).toContain("/live/update");
  expect(script).toContain("live:click");
  expect(script).toContain("live:model");
  expect(script).toContain("live:poll");
  expect(script).toContain("function morph");
  expect(script).toContain("CustomEvent");
});

test("mount includes unique live:id root attribute", async () => {
  Live.component("counter", Counter);
  const html = await Live.mount("counter");
  expect(html).toMatch(/live:id="[^"]+"/);
  const snapshot = snapshotFromHtml(html);
  expect(snapshot.id).toBeTruthy();
  expect(html).toContain(`live:id="${snapshot.id}"`);
});

test("update preserves snapshot id and returns effects", async () => {
  Live.component("counter", Counter);
  const mounted = await Live.mount("counter");
  const snapshot = snapshotFromHtml(mounted);
  const result = await Live.update({
    name: "counter",
    snapshot,
    calls: [{ method: "increment" }],
  });
  expect(result.snapshot.id).toBe(snapshot.id);
  expect(result.effects.events).toEqual([]);
  expect(result.effects.redirect).toBeNull();
});

test("dispatch and redirect populate effects", async () => {
  class Toast extends LiveComponent {
    notify() {
      this.dispatch("toast", { message: "hi" });
      this.redirect("/done");
    }
    html() {
      return `<button type="button" live:click="notify">Go</button>`;
    }
  }
  Live.component("toast", Toast);
  const snapshot = makeSnapshot("toast", {});
  const result = await Live.update({
    name: "toast",
    snapshot,
    calls: [{ method: "notify" }],
  });
  expect(result.effects.events).toEqual([{ name: "toast", params: { message: "hi" } }]);
  expect(result.effects.redirect).toBe("/done");
});

test("navigate effect for SPA live:navigate", async () => {
  class Go extends LiveComponent {
    next() {
      this.navigate("/home");
    }
    html() {
      return `<button live:click="next">Next</button>`;
    }
  }
  Live.component("go", Go);
  const result = await Live.update({
    name: "go",
    snapshot: makeSnapshot("go", {}),
    calls: [{ method: "next" }],
  });
  expect(result.effects.navigate).toBe("/home");
});

test("clientScript includes live:navigate", () => {
  const script = clientScript();
  expect(script).toContain("live:navigate");
  expect(script).not.toContain("wire:navigate");
  expect(script).toContain("navigateTo");
  expect(script).toContain("live:navigated");
  expect(script).toContain("prefetchCache");
});

test("clientScript sends data-model values with actions and polls", () => {
  const script = clientScript();
  expect(script).toContain("collectModelUpdates");
  expect(script).toContain("updates: collectModelUpdates(root)");
});

test("validate sets error bag on failure", async () => {
  class Form extends LiveComponent {
    email = "";
    async save() {
      await this.validate({ email: "required|email" });
    }
    html() {
      return `<p>${this.email}</p>`;
    }
  }
  Live.component("form", Form);
  const snapshot = makeSnapshot("form", { email: "" });
  const result = await Live.update({
    name: "form",
    snapshot,
    calls: [{ method: "save" }],
  });
  expect(result.effects.errors?.email?.length).toBeGreaterThan(0);
});

test("nested live component embeds child with own snapshot", async () => {
  Live.component("counter", Counter);

  class Dashboard extends LiveComponent {
    title = "Home";

    async html() {
      return `<h1>${this.title}</h1>${await this.live("counter", {}, { key: "main" })}`;
    }
  }

  Live.component("dashboard", Dashboard);
  const html = await Live.mount("dashboard");
  expect(html).toContain('data-live="dashboard"');
  expect(html).toContain('data-live="counter"');
  expect(html).toContain('data-count="0"');

  const parentSnap = snapshotFromHtml(html);
  expect(parentSnap.children?.main).toBeTruthy();
  assertSnapshot(parentSnap);
  assertSnapshot(parentSnap.children!.main!);
});

test("nested child state survives parent re-render", async () => {
  Live.component("counter", Counter);

  class Dashboard extends LiveComponent {
    title = "Home";

    rename() {
      this.title = "Renamed";
    }

    async html() {
      return `<h1>${this.title}</h1>${await this.live("counter", {}, { key: "main" })}`;
    }
  }

  Live.component("dashboard", Dashboard);
  const mounted = await Live.mount("dashboard");
  const parentSnap = snapshotFromHtml(mounted);

  const childSnap = parentSnap.children!.main!;
  const childUpdated = await Live.update({
    name: "counter",
    snapshot: childSnap,
    calls: [{ method: "increment" }],
  });

  // Parent snapshot checksum stays as mounted; live children arrive via payload.
  const parentUpdated = await Live.update({
    name: "dashboard",
    snapshot: parentSnap,
    calls: [{ method: "rename" }],
    children: { main: childUpdated.snapshot },
  });

  expect(parentUpdated.html).toContain("Renamed");
  expect(parentUpdated.html).toContain('data-count="1"');
  expect(parentUpdated.snapshot.children!.main!.data.count).toBe(1);
  expect(parentUpdated.snapshot.children!.main!.id).toBe(childUpdated.snapshot.id);
});

test("clientScript collects nested children on update", () => {
  const script = clientScript();
  expect(script).toContain("collectNestedChildren");
  expect(script).toContain("payload.children");
});

test("clientScript registers Alpine $live.entangle", () => {
  const script = clientScript();
  expect(script).toContain("entangle");
  expect(script).toContain("alpine:init");
  expect(script).toContain('magic("wire"');
});

test("boot runs on mount and each update", async () => {
  const boots: string[] = [];

  class Booted extends LiveComponent {
    n = 0;
    boot() {
      boots.push(`boot:${this.n}`);
    }
    tick() {
      this.n += 1;
    }
    html() {
      return `<span>${this.n}</span>`;
    }
  }

  Live.component("booted", Booted);
  await Live.mount("booted");
  expect(boots).toEqual(["boot:0"]);

  const snapshot = makeSnapshot("booted", { n: 0 });
  await Live.update({
    name: "booted",
    snapshot,
    calls: [{ method: "tick" }],
  });
  expect(boots).toEqual(["boot:0", "boot:1"]);
});

test("child() alias embeds nested component", async () => {
  Live.component("counter", Counter);

  class Parent extends LiveComponent {
    async html() {
      return `<div>${await this.child("counter", {}, { key: "c" })}</div>`;
    }
  }

  Live.component("parent", Parent);
  const html = await Live.mount("parent");
  expect(html).toContain('data-live="counter"');
  const snap = snapshotFromHtml(html);
  expect(snap.children?.c).toBeTruthy();
});

test("mount applies props before mount hook", async () => {
  const seen: unknown[] = [];

  class WithMount extends LiveComponent {
    title = "";
    mount(props: Record<string, unknown>) {
      seen.push(props);
      seen.push(this.title);
    }
    html() {
      return `<h1>${this.title}</h1>`;
    }
  }

  Live.component("with-mount", WithMount);
  const html = await Live.mount("with-mount", { title: "Hello" });
  expect(seen[0]).toEqual({ title: "Hello" });
  expect(seen[1]).toBe("Hello");
  expect(html).toContain("Hello");
});

test("Live.scripts emits deferred script tag", () => {
  expect(Live.scripts()).toBe(
    '<script src="/live/live.js" defer></script>',
  );
  expect(Live.scripts("/custom.js")).toContain('src="/custom.js"');
});

test("Live.routes registers update + script named routes", async () => {
  const { Router } = await import("@bunyad/router");
  const router = new Router();
  Live.routes(router, {
    updatePath: "/lw/update",
    scriptPath: "/lw/livewire.js",
  });
  expect(router.has("live.script")).toBe(true);
  expect(router.has("live.update")).toBe(true);
  const routes = router.getRoutes();
  const script = routes.find((r) => r.name === "live.script");
  const update = routes.find((r) => r.name === "live.update");
  expect(script?.uri).toBe("/lw/livewire.js");
  expect(script?.methods).toContain("GET");
  expect(update?.uri).toBe("/lw/update");
  expect(update?.methods).toContain("POST");
});

test("resolve throws for unregistered component", () => {
  expect(() => Live.resolve("missing")).toThrow(/not registered/);
});

test("clientScript entangle does not rewrite signed data-snapshot", () => {
  const script = clientScript();
  expect(script).toContain("entangle");
  expect(script).toContain("Keep Alpine local state only");
  expect(script).not.toContain("base64FromUtf8");
  // Must send updates via sendModel without inventing checksum.
  const entangleIdx = script.indexOf("entangle(name, options)");
  const setBlock = script.slice(entangleIdx, entangleIdx + 600);
  expect(setBlock).toContain("sendModel(root, name, value)");
  expect(setBlock).not.toContain('setAttribute(\n                "data-snapshot"');
  expect(setBlock).not.toContain('setAttribute("data-snapshot"');
});

test("checksumFor requires APP_KEY in production", () => {
  const prevEnv = process.env.APP_ENV;
  const prevNode = process.env.NODE_ENV;
  const prevKey = process.env.APP_KEY;
  try {
    process.env.APP_ENV = "production";
    process.env.NODE_ENV = "production";
    delete process.env.APP_KEY;
    expect(() => checksumFor("x", "id", {})).toThrow(/APP_KEY/);
  } finally {
    if (prevEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prevEnv;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevKey === undefined) delete process.env.APP_KEY;
    else process.env.APP_KEY = prevKey;
  }
});

test("a ValidationException thrown by an action reaches the error bag", async () => {
  const { ValidationException } = await import("@bunyad/validation");

  class Login extends LiveComponent {
    email = "";

    login() {
      throw ValidationException.withMessages({ email: "These credentials do not match our records." });
    }

    remind() {
      this.addError("email", "Check your inbox.");
    }

    html() {
      return `<p>${this.getErrorBag().email?.[0] ?? ""}</p>`;
    }
  }

  Live.component("login", Login);
  const failed = await Live.update({
    name: "login",
    snapshot: makeSnapshot("login", { email: "" }),
    calls: [{ method: "login", params: [] }],
  });
  expect(failed.html).toContain("These credentials do not match our records.");
  expect(failed.effects.errors?.email).toEqual(["These credentials do not match our records."]);

  const reminded = await Live.update({
    name: "login",
    snapshot: makeSnapshot("login", { email: "" }),
    calls: [{ method: "remind", params: [] }],
  });
  expect(reminded.html).toContain("Check your inbox.");
});

test("error bag helpers are not callable from the client", async () => {
  Live.component("counter", Counter);
  await expect(
    Live.update({
      name: "counter",
      snapshot: makeSnapshot("counter", { count: 0 }),
      calls: [{ method: "addError", params: ["count", "x"] }],
    }),
  ).rejects.toThrow(/not callable/);
});

test("clientScript submits live:submit forms and defers models", () => {
  const script = clientScript();
  expect(script).toContain('"live:submit"');
  expect(script).toContain('"live:model.defer"');
  expect(script).not.toContain("wire\\\\:");
});

test("Live.route mounts a full-page component inside its layout", async () => {
  const { Router, setActiveRouter, setRouteViewRenderer } = await import("@bunyad/router");
  const router = new Router();
  setActiveRouter(router);
  setRouteViewRenderer(() => new Response(""));

  class Page extends LiveComponent {
    static layout = "layouts.auth";
    static title = "Log in";
    html() {
      return "<form></form>";
    }
  }
  Live.component("auth.login", Page);
  Live.route("/login", "auth.login").name("login");

  expect(router.has("login")).toBe(true);
});
