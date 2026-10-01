import { expect, test } from "bun:test";
import {
  Request,
  json,
  stream,
  streamJson,
  eventStream,
  streamDownload,
  download,
  file,
  noContent,
  response,
  runPipeline,
  abort,
  HttpException,
  HttpResponse,
  FormRequest,
  JsonResource,
  JsonApiResource,
  type JsonApiResourceObject,
  RateLimiter,
  type RateLimitResult,
  UploadedFile,
  abort_if,
  abort_unless,
  expandMiddlewareGroups,
  Controller,
  aliasMiddleware,
  taggedMiddleware,
  controllerMiddlewareOf,
  mergeControllerMiddleware,
  middlewareAliasOf,
} from "../src/index.ts";
import {
  authMwForDecorator,
  decoratorDemoStack,
  throttleMwForDecorator,
} from "./decorators.fixture.ts";
import {
  stringAliasDemoStack,
  stringAliasControllerOnly,
} from "./decorators.string.fixture.ts";

test("request reads query and route params", async () => {
  const req = new Request(new globalThis.Request("http://localhost/users?x=1"), {
    id: "5",
  });
  expect(req.input("id")).toBe("5");
  expect(req.input("x")).toBe("1");
});

test("request queryValues collects repeated keys and bracket suffix", () => {
  const req = new Request(
    new globalThis.Request(
      "http://localhost/p?categoryIds[]=1&categoryIds[]=2&q=a&empty=",
    ),
  );
  expect(req.queryValues("categoryIds")).toEqual(["1", "2"]);
  expect(req.queryValues("q")).toEqual(["a"]);
  expect(req.queryValues("empty")).toEqual([]);
  expect(req.queryValues("missing")).toEqual([]);
});

test("json helper", async () => {
  const res = json({ ok: true });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("json helper accepts header map", async () => {
  const res = json({ ok: true }, 201, { "X-Custom": "1" });
  expect(res.status).toBe(201);
  expect(res.headers.get("X-Custom")).toBe("1");
  expect(res.headers.get("Content-Type")).toContain("application/json");
  expect(await res.json()).toEqual({ ok: true });
});

test("response().json builds a JSON Fetch Response", async () => {
  const res = response().json({ ok: true }, 201);
  expect(res).toBeInstanceOf(Response);
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ ok: true });
});

test("no-arg response() is the factory (response.json / response().file)", async () => {
  expect(response()).toBe(response);
  const fromFactory = response.json({ ok: true });
  expect(await fromFactory.json()).toEqual({ ok: true });
});

test("response(body, init) still builds a Fetch Response", async () => {
  const res = response("hello", { status: 201 });
  expect(res).toBeInstanceOf(Response);
  expect(res.status).toBe(201);
  expect(await res.text()).toBe("hello");
});

test("middleware pipeline order", async () => {
  const order: number[] = [];
  const req = new Request(new globalThis.Request("http://localhost/"));
  const res = await runPipeline(
    req,
    [
      async (_r, next) => {
        order.push(1);
        const out = await next();
        order.push(4);
        return out;
      },
      async (_r, next) => {
        order.push(2);
        return next();
      },
    ],
    async () => {
      order.push(3);
      return json({ ok: true });
    },
  );
  expect(order).toEqual([1, 2, 3, 4]);
  expect(res.status).toBe(200);
});

test("middleware next(request) replaces request for later layers", async () => {
  const original = new Request(new globalThis.Request("http://localhost/a"));
  const replaced = new Request(new globalThis.Request("http://localhost/b"));
  let seenUrl = "";
  await runPipeline(
    original,
    [
      async (_r, next) => next(replaced),
      async (r, next) => {
        seenUrl = r.url;
        return next();
      },
    ],
    async (r) => {
      expect(r.url).toContain("/b");
      return json({ ok: true });
    },
  );
  expect(seenUrl).toContain("/b");
});

test("middleware handle receives alias params", async () => {
  const { aliasMiddleware, resolveMiddlewareStack } = await import(
    "../src/middleware-alias.ts"
  );
  let got: string[] = [];
  aliasMiddleware("role", () => ({
    async handle(_req, next, ...params) {
      got = params;
      return next();
    },
  }));
  const stack = resolveMiddlewareStack(["role:editor,admin"]);
  const req = new Request(new globalThis.Request("http://localhost/"));
  await runPipeline(req, stack, async () => json({ ok: true }));
  expect(got).toEqual(["editor", "admin"]);
});

test("middleware terminate runs after response", async () => {
  const order: string[] = [];
  const req = new Request(new globalThis.Request("http://localhost/"));
  await runPipeline(
    req,
    [
      {
        async handle(_r, next) {
          order.push("handle");
          return next();
        },
        async terminate() {
          order.push("terminate");
        },
      },
    ],
    async () => {
      order.push("dest");
      return json({ ok: true });
    },
  );
  expect(order).toEqual(["handle", "dest", "terminate"]);
});

test("Controller middleware only/except", () => {
  aliasMiddleware(
    "log",
    () =>
      taggedMiddleware("log", {
        async handle(_r, next) {
          return next();
        },
      }),
  );

  class PostsController extends Controller {
    constructor() {
      super();
      this.middleware("log").only("index");
    }
    index() {
      return json([]);
    }
    show() {
      return json({});
    }
  }
  new PostsController();
  expect(controllerMiddlewareOf(PostsController, "index").length).toBeGreaterThan(
    0,
  );
  expect(controllerMiddlewareOf(PostsController, "show")).toHaveLength(0);

  class AdminController extends Controller {
    constructor() {
      super();
      this.middleware("log").except("create");
    }
    index() {
      return json([]);
    }
    create() {
      return json({});
    }
  }
  new AdminController();
  expect(controllerMiddlewareOf(AdminController, "index").length).toBeGreaterThan(
    0,
  );
  const createStack = mergeControllerMiddleware([], AdminController, "create");
  expect(
    createStack.every((m) => middlewareAliasOf(m) !== "log"),
  ).toBe(true);
});

test("expandMiddlewareGroups expands web and leaves aliases", () => {
  const web = [
    { async handle(_r: Request, next: () => Response | Promise<Response>) { return next(); } },
  ];
  const expanded = expandMiddlewareGroups(["web", "auth:token"], (name) =>
    name === "web" ? web : undefined,
  );
  expect(expanded).toHaveLength(2);
  expect(expanded[0]).toBe(web[0]);
  expect(expanded[1]).toBe("auth:token");
});

test("sortMiddlewareByPriority reorders listed aliases", async () => {
  const { sortMiddlewareByPriority, taggedMiddleware } = await import(
    "./middleware-alias.ts"
  );
  const session = taggedMiddleware("session", {
    async handle(_r: Request, next: () => Response | Promise<Response>) {
      return next();
    },
  });
  const bindings = taggedMiddleware("bindings", {
    async handle(_r: Request, next: () => Response | Promise<Response>) {
      return next();
    },
  });
  const auth = taggedMiddleware("auth", {
    async handle(_r: Request, next: () => Response | Promise<Response>) {
      return next();
    },
  });
  const sorted = sortMiddlewareByPriority(
    [auth, bindings, session],
    ["session", "bindings"],
  );
  expect(middlewareAliasOf(sorted[0]!)).toBe("session");
  expect(middlewareAliasOf(sorted[1]!)).toBe("bindings");
  expect(middlewareAliasOf(sorted[2]!)).toBe("auth");
});

test("abort throws HttpException", () => {
  expect(() => abort(404)).toThrow(HttpException);
});

test("abort_if and abort_unless", () => {
  expect(() => abort_if(false, 403)).not.toThrow();
  expect(() => abort_if(true, 403, "Denied")).toThrow(HttpException);

  expect(() => abort_unless(true, 404)).not.toThrow();
  expect(() => abort_unless(false, 404, "Missing")).toThrow(HttpException);

  try {
    abort_if(true, 422, "Invalid");
  } catch (e) {
    expect((e as HttpException).status).toBe(422);
    expect((e as HttpException).message).toBe("Invalid");
  }

  try {
    abort(401, "Auth", { "WWW-Authenticate": 'Basic realm="api"' });
  } catch (e) {
    expect((e as HttpException).status).toBe(401);
    expect((e as HttpException).headers["WWW-Authenticate"]).toBe(
      'Basic realm="api"',
    );
  }
});

test("request.validate returns data or throws", async () => {
  const req = new Request(
    new globalThis.Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.c" }),
    }),
  );
  const data = await req.validate({ email: "required|email" });
  expect(data.email).toBe("a@b.c");
});

class StoreUserRequest extends FormRequest {
  authorize() {
    return true;
  }

  rules() {
    return {
      name: "required|string|min:2",
      email: "required|email",
    };
  }
}

class ForbiddenRequest extends FormRequest {
  authorize() {
    return false;
  }

  rules() {
    return { name: "required" };
  }
}

test("FormRequest.from accepts GET with JSON content-type and empty body", async () => {
  class FindBySlugRequest extends FormRequest {
    authorize() {
      return true;
    }
    rules() {
      return { slug: "required|string" };
    }
  }
  const req = new Request(
    new globalThis.Request("http://localhost/tenants/find/acme", {
      method: "GET",
      headers: { "content-type": "application/json" },
    }),
    { slug: "acme" },
  );
  const form = await FindBySlugRequest.from(req);
  expect(form.validated()).toEqual({ slug: "acme" });
});

test("FormRequest.from validates and exposes validated()", async () => {
  const req = new Request(
    new globalThis.Request("http://localhost/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada", email: "ada@example.com" }),
    }),
  );
  const form = await StoreUserRequest.from(req);
  expect(form.validated()).toEqual({ name: "Ada", email: "ada@example.com" });
  expect(form.validated("email")).toBe("ada@example.com");
  expect(form.safe(["email"])).toEqual({ email: "ada@example.com" });
  expect(form.safe().only("email")).toEqual({ email: "ada@example.com" });
  expect(form.safe().except("name")).toEqual({ email: "ada@example.com" });
  expect(form.safe().all()).toEqual({ name: "Ada", email: "ada@example.com" });
  expect(form.input("name")).toBe("Ada");
});

test("FormRequest trims and casts values for matching keys", async () => {
  class StoreItemRequest extends FormRequest {
    authorize() {
      return true;
    }
    rules() {
      return {
        name: "required|string",
        parentId: "nullable|integer",
        trackByUniqueId: "boolean",
      };
    }
  }
  const req = new Request(
    new globalThis.Request("http://localhost/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "  Phones  ",
        parentId: "4",
        trackByUniqueId: "1",
      }),
    }),
  );
  const form = await StoreItemRequest.from(req);
  expect(form.validated()).toEqual({
    name: "Phones",
    parentId: 4,
    trackByUniqueId: true,
  });
  expect(form.input("parentId")).toBe("4");
});

test("FormRequest does not map camelCase input onto snake_case rules", async () => {
  class StoreItemRequest extends FormRequest {
    authorize() {
      return true;
    }
    rules() {
      return {
        parent_id: "required|integer",
      };
    }
  }
  const req = new Request(
    new globalThis.Request("http://localhost/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: 4 }),
    }),
  );

  try {
    await StoreItemRequest.from(req);
    throw new Error("expected throw");
  } catch (e) {
    const { ValidationException } = await import("@bunyad/validation");
    expect(e).toBeInstanceOf(ValidationException);
  }
});

test("FormRequest.from reuses an already-validated instance", async () => {
  const req = new Request(
    new globalThis.Request("http://localhost/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada", email: "ada@example.com" }),
    }),
  );
  const form = await StoreUserRequest.from(req);
  expect(await StoreUserRequest.from(form)).toBe(form);
});

test("FormRequest attributes customize validation labels", async () => {
  class LabeledRequest extends FormRequest {
    authorize() {
      return true;
    }
    rules() {
      return { email: "required|email" };
    }
    attributes() {
      return { email: "email address" };
    }
  }

  const req = new Request(
    new globalThis.Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "" }),
    }),
  );

  try {
    await LabeledRequest.from(req);
    throw new Error("expected throw");
  } catch (e) {
    const { ValidationException } = await import("@bunyad/validation");
    expect(e).toBeInstanceOf(ValidationException);
    expect((e as InstanceType<typeof ValidationException>).errors.email?.[0]).toBe(
      "The email address field is required.",
    );
  }
});

test("FormRequest.from aborts when authorize fails", async () => {
  const req = new Request(
    new globalThis.Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    }),
  );
  await expect(ForbiddenRequest.from(req)).rejects.toThrow(HttpException);
});

class UniqueFormRequest extends FormRequest {
  authorize() {
    return true;
  }
  rules() {
    return {
      email: this.uniqueExceptRouteModel("users", "email", "user"),
    };
  }
}

test("FormRequest uniqueExceptRouteModel builds ignore rule", () => {
  const form = new UniqueFormRequest(
    new globalThis.Request("http://localhost/users/5"),
    { user: "5" },
  );
  form.setModel("user", { id: 5, email: "ada@example.com" });
  expect(form.rules().email).toBe("unique:users,email,5,id");
  expect(form.uniqueExcept("users", "email", 1)).toBe("unique:users,email,1,id");
});

class UserResource extends JsonResource<{ id: number; name: string; secret: string }> {
  toArray() {
    return { id: this.resource.id, name: this.resource.name };
  }
}

test("JsonResource make and collection", async () => {
  const one = await UserResource.make({
    id: 1,
    name: "Ada",
    secret: "x",
  }).response();
  expect(await one.json()).toEqual({ data: { id: 1, name: "Ada" } });

  const many = await UserResource.collection([
    { id: 1, name: "Ada", secret: "x" },
    { id: 2, name: "Bob", secret: "y" },
  ]);
  expect(await many.json()).toEqual({
    data: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bob" },
    ],
  });
  expect(many.resolve()).toEqual([
    { id: 1, name: "Ada" },
    { id: 2, name: "Bob" },
  ]);
});

test("JsonResource collection accepts paginator", async () => {
  const paginator = {
    items: [
      { id: 1, name: "Ada", secret: "x" },
      { id: 2, name: "Bob", secret: "y" },
    ],
    perPage: 2,
    toJSON(data?: readonly Record<string, unknown>[]) {
      return {
        data: data ?? this.items,
        links: { next: "/users?page=2", prev: null, first: "/users?page=1", last: "/users?page=3" },
        meta: {
          current_page: 1,
          per_page: 2,
          total: 5,
          last_page: 3,
        },
      };
    },
  };
  const collected = UserResource.collection(paginator);
  expect(collected.resolve()).toEqual([
    { id: 1, name: "Ada" },
    { id: 2, name: "Bob" },
  ]);
  const body = (await collected.json()) as {
    data: Array<{ id: number; name: string }>;
    meta: Record<string, unknown>;
    links: { next?: string };
  };
  expect(body.data).toEqual([
    { id: 1, name: "Ada" },
    { id: 2, name: "Bob" },
  ]);
  expect(body.meta).toMatchObject({
    current_page: 1,
    per_page: 2,
    total: 5,
    last_page: 3,
  });
  expect(body.links.next).toContain("page=2");
});

test("JsonResource collection accepts all() collections", async () => {
  const collected = UserResource.collection({
    all: () => [
      { id: 1, name: "Ada", secret: "x" },
      { id: 2, name: "Bob", secret: "y" },
    ],
  });
  expect(collected.resolve()).toEqual([
    { id: 1, name: "Ada" },
    { id: 2, name: "Bob" },
  ]);
  expect(await collected.json()).toEqual({
    data: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Bob" },
    ],
  });
});

test("JsonResource toResponse(request) matches kernel Responsable", async () => {
  const req = new Request(new globalThis.Request("http://localhost/users"));
  const res = UserResource.make({
    id: 1,
    name: "Ada",
    secret: "x",
  }).toResponse(req);
  expect(await res.json()).toEqual({ data: { id: 1, name: "Ada" } });
});

test("JsonResource paginate", async () => {
  const paginator = {
    items: [
      { id: 1, name: "Ada", secret: "x" },
      { id: 2, name: "Bob", secret: "y" },
    ],
    toJSON(data: Record<string, unknown>[]) {
      return {
        data,
        links: { next: "/users?page=2", prev: null, first: "/users?page=1", last: "/users?page=3" },
        meta: {
          current_page: 1,
          per_page: 2,
          total: 5,
          last_page: 3,
        },
      };
    },
  };
  const res = await UserResource.paginate(paginator);
  const body = (await res.json()) as {
    data: Array<{ id: number; name: string }>;
    meta: Record<string, unknown>;
    links: { next?: string };
  };
  expect(body.data).toEqual([
    { id: 1, name: "Ada" },
    { id: 2, name: "Bob" },
  ]);
  expect(body.meta).toMatchObject({
    current_page: 1,
    per_page: 2,
    total: 5,
    last_page: 3,
  });
  expect(body.links.next).toContain("page=2");
});

test("JsonResource collection additional merges onto paginated payload", async () => {
  const paginator = {
    items: [{ id: 1, name: "Ada", secret: "x" }],
    toJSON(data?: readonly Record<string, unknown>[]) {
      return {
        data: data ?? this.items,
        links: { next: null },
        meta: { current_page: 1, per_page: 1, total: 1, last_page: 1 },
      };
    },
  };
  const body = await UserResource.collection(paginator)
    .additional({ meta: { extra: true } })
    .json();
  expect(body).toMatchObject({
    data: [{ id: 1, name: "Ada" }],
    meta: { extra: true, current_page: 1 },
  });
});

test("JsonResource nested toJSON is unwrapped", () => {
  class PostResource extends JsonResource<{ id: number; title: string }> {
    toArray() {
      return { id: this.resource.id, title: this.resource.title };
    }
  }
  class AuthorResource extends JsonResource<{
    id: number;
    name: string;
    post: { id: number; title: string };
  }> {
    toArray() {
      return {
        id: this.resource.id,
        name: this.resource.name,
        post: PostResource.make(this.resource.post),
      };
    }
  }
  const encoded = JSON.stringify(
    AuthorResource.make({
      id: 1,
      name: "Ada",
      post: { id: 9, title: "Hi" },
    }).resolve(),
  );
  expect(JSON.parse(encoded)).toEqual({
    id: 1,
    name: "Ada",
    post: { id: 9, title: "Hi" },
  });
});

class ConditionalResource extends JsonResource<{
  id: number;
  email?: string;
  admin?: boolean;
}> {
  toArray() {
    return {
      id: this.resource.id,
      email: this.when(Boolean(this.resource.email), this.resource.email),
      ...this.mergeWhen(Boolean(this.resource.admin), { role: "admin" }),
    };
  }
}

test("JsonResource when and mergeWhen", async () => {
  const plain = await ConditionalResource.make({ id: 1 }).response();
  expect(await plain.json()).toEqual({ data: { id: 1 } });

  const full = await ConditionalResource.make({
    id: 2,
    email: "a@b.c",
    admin: true,
  }).response();
  expect(await full.json()).toEqual({
    data: { id: 2, email: "a@b.c", role: "admin" },
  });
});

test("request.ip and throttle middleware", async () => {
  const { RateLimiter, throttle } = await import("../src/index.ts");
  const limiter = new RateLimiter();
  const mw = throttle(2, 1, {
    limiter,
    key: () => "test",
  });

  const req = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
    }),
  );
  // Default: trust no proxies — spoofed XFF must not change ip().
  expect(req.ip()).toBe("127.0.0.1");

  const ok = await mw.handle(req, async () => json({ ok: true }));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("X-RateLimit-Remaining")).toBe("1");

  await mw.handle(req, async () => json({ ok: true }));
  const blocked = await mw.handle(req, async () => json({ ok: true }));
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("Retry-After")).toBeTruthy();
});

test("request has integer merge path wantsJson", async () => {
  const req = new Request(
    new globalThis.Request("https://example.com/users/1?page=2&q=ada", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ count: "3", name: "Ada" }),
    }),
    { id: "1" },
  );
  await req.loadJson();

  expect(req.has("page", "name")).toBe(true);
  expect(req.hasAny("missing", "name")).toBe(true);
  expect(req.integer("page")).toBe(2);
  expect(req.integer("count")).toBe(3);
  expect(req.float("page")).toBe(2);
  expect(req.string("name")).toBe("Ada");
  expect(req.isMethod("post")).toBe(true);
  expect(req.wantsJson()).toBe(true);
  expect(req.ajax()).toBe(true);
  expect(req.expectsJson()).toBe(true);
  expect(req.path()).toBe("users/1");
  expect(req.host()).toBe("example.com");
  expect(req.scheme()).toBe("https");
  expect(req.secure()).toBe(true);
  expect(req.fullUrl()).toContain("page=2");

  req.merge({ role: "admin" });
  expect(req.input("role")).toBe("admin");
  req.mergeIfMissing({ role: "user", team: "core" });
  expect(req.input("role")).toBe("admin");
  expect(req.input("team")).toBe("core");
  expect(req.collect("name").all()).toEqual(["Ada"]);
});

test("request accepts cookie date enum segments is", async () => {
  const req = new Request(
    new globalThis.Request("https://example.com/posts/42/edit?x=1", {
      method: "GET",
      headers: {
        Accept: "application/json, text/html",
        Cookie: "session=abc; theme=dark",
      },
    }),
  );
  req.merge({
    status: "active",
    tags: ["a", "b"],
    published_at: "2024-01-15T00:00:00.000Z",
    qty: "5",
  });

  expect(req.acceptsJson()).toBe(true);
  expect(req.acceptsHtml()).toBe(true);
  expect(req.cookie("theme")).toBe("dark");
  expect(req.exists("status")).toBe(true);
  expect(req.anyFilled("missing", "status")).toBe(true);
  expect(req.array("tags")).toEqual(["a", "b"]);
  expect(req.date("published_at")?.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  expect(req.enum("status", { Active: "active", Draft: "draft" })).toBe("active");
  expect(req.segments()).toEqual(["posts", "42", "edit"]);
  expect(req.segment(2)).toBe("42");
  expect(req.is("posts/*")).toBe(true);
  expect(req.clamp("qty", 1, 3)).toBe(3);
  expect(req.root()).toBe("https://example.com");
  expect(req.urlWithoutQuery()).toBe("https://example.com/posts/42/edit");
  expect(req.fingerprint()).toContain("GET|");
});

test("RateLimiter attempts remaining hit decrement", () => {
  const limiter = new RateLimiter();
  expect((limiter.attempt("k", 3, 60) as RateLimitResult).allowed).toBe(true);
  expect(limiter.attempts("k")).toBe(1);
  expect(limiter.remaining("k", 3)).toBe(2);
  limiter.hit("k", 60);
  expect(limiter.attempts("k")).toBe(2);
  limiter.decrement("k");
  expect(limiter.attempts("k")).toBe(1);
  expect(limiter.availableIn("k")).toBeGreaterThanOrEqual(0);
  limiter.resetAttempts("k");
  expect(limiter.attempts("k")).toBe(0);
  expect(limiter.cleanRateLimiterKey("a:b&c")).toBe("abc");
});

test("UploadedFile.fake and JsonResource additional", async () => {
  const file = UploadedFile.fake().create("doc.txt", "hello", "text/plain");
  expect(file.getClientOriginalName()).toBe("doc.txt");
  expect(file.extension()).toBe("txt");
  expect(file.getMimeType()).toContain("text/plain");
  expect(file.hashName()).toContain(".txt");

  class UserResource extends JsonResource<{ id: number }> {
    toArray() {
      return { id: this.resource.id };
    }
  }
  const res = await new UserResource({ id: 1 })
    .additional({ meta: { ok: true } })
    .response();
  const body = await res.json();
  expect(body).toEqual({ data: { id: 1 }, meta: { ok: true } });
});

test("Limit presets and registerRateLimitPresets", async () => {
  const { RateLimiter, Limit, registerRateLimitPresets, throttle, Request } =
    await import("../src/index.ts");
  const req = new Request(new globalThis.Request("http://localhost/"));

  expect(Limit.auth(req).maxAttempts).toBe(5);
  expect(Limit.tokens(req).maxAttempts).toBe(10);
  expect(Limit.api(req).maxAttempts).toBe(60);

  const limiter = new RateLimiter();
  registerRateLimitPresets(limiter);
  const authMw = throttle("auth", 1, { limiter });

  for (let i = 0; i < 5; i++) {
    expect(
      (await authMw.handle(req, async () => json({ ok: true }))).status,
    ).toBe(200);
  }
  expect((await authMw.handle(req, async () => json({ ok: true }))).status).toBe(
    429,
  );
});

test("multipart request.file and UploadedFile.store", async () => {
  const { Storage } = await import("@bunyad/filesystem");
  const fake = Storage.fake();

  const form = new FormData();
  form.append("title", "Avatar");
  form.append(
    "avatar",
    new File([new Uint8Array([1, 2, 3, 4])], "photo.png", {
      type: "image/png",
    }),
  );

  const req = new Request(
    new globalThis.Request("http://localhost/upload", {
      method: "POST",
      body: form,
    }),
  );
  await req.loadJson();

  expect(req.input("title")).toBe("Avatar");
  expect(req.hasFile("avatar")).toBe(true);
  expect(req.boolean("missing")).toBe(false);
  expect(req.filled("title")).toBe(true);
  expect(req.only(["title"])).toEqual({ title: "Avatar" });

  const file = req.file("avatar");
  expect(file).toBeTruthy();
  if (!file || Array.isArray(file)) throw new Error("expected single file");
  expect(file.getClientOriginalName()).toBe("photo.png");
  expect(file.getClientOriginalExtension()).toBe("png");
  expect(file.isValid()).toBe(true);
  expect(file.mimeType).toBe("image/png");

  const path = await file.store("avatars");
  expect(path.startsWith("avatars/")).toBe(true);
  expect(path.endsWith(".png")).toBe(true);
  fake.assertExists(path);

  const validated = await req.validate({
    title: "required|string",
    avatar: "required|file|image|mimes:png,jpg|max:1024",
  });
  expect(validated.title).toBe("Avatar");

  Storage.restore();
});

test("Middleware / WithoutMiddleware decorators collect metadata", () => {
  const stack = decoratorDemoStack();
  expect(stack).toHaveLength(1);
  expect(stack[0]).toBe(throttleMwForDecorator);
  expect(stack[0]).not.toBe(authMwForDecorator);
});

test("request whenMissing hasHeader flashOnly", () => {
  const bag: Record<string, unknown> = {};
  const req = new Request(
    new globalThis.Request("http://localhost/?a=1", {
      headers: { "x-test": "1", cookie: "c=v" },
    }),
  );
  req.session = {
    get: (k, d) => (k in bag ? (bag[k] as never) : (d as never)),
    put: (k, v) => {
      bag[k] = v;
    },
    flash: (k, v) => {
      bag[k] = v;
    },
    has: (k) => k in bag,
    forget: (k) => {
      delete bag[k];
    },
  };
  expect(req.hasHeader("x-test")).toBe(true);
  expect(req.hasCookie("c")).toBe(true);
  expect(req.whenMissing("missing", () => "yes")).toBe("yes");
  req.flashOnly(["a"]);
  expect(req.old("a")).toBe("1");
});

test("JsonResource whenLoaded toJson", () => {
  class R extends JsonResource<{ id: number; posts?: string[] }> {
    toArray() {
      return {
        id: this.resource.id,
        posts: this.whenLoaded("posts"),
        name: this.whenNotNull(null as string | null),
      };
    }
  }
  const res = new R({ id: 1, posts: ["a"] });
  expect(res.resolve()).toEqual({ id: 1, posts: ["a"] });
  expect(JSON.parse(res.toJson()).id).toBe(1);
});

test("HttpResponse withHeaders withCookie", () => {
  const res = HttpResponse.from("ok", 200)
    .withHeaders({ "X-A": "1" })
    .withCookie("sid", "abc", { path: "/" });
  expect(res.content()).toBe("ok");
  expect(res.status()).toBe(200);
  const fetchRes = res.toFetch();
  expect(fetchRes.headers.get("X-A")).toBe("1");
  expect(fetchRes.headers.get("Set-Cookie")).toContain("sid=");
});

test("withCookie encrypts values except listed names", () => {
  const { Crypt } = require("@bunyad/common") as typeof import("@bunyad/common");
  const {
    resetCookieEncryptionForTests,
    setEncryptedCookieExcept,
  } = require("../src/cookie-encryption.ts") as typeof import("../src/cookie-encryption.ts");
  Crypt.setKey("base64:" + Buffer.alloc(32, 7).toString("base64"));
  resetCookieEncryptionForTests();
  setEncryptedCookieExcept(["bunyad_session", "XSRF-TOKEN"]);

  const encrypted = HttpResponse.from("ok")
    .withCookie("prefs", "dark")
    .toFetch()
    .headers.get("Set-Cookie")!;
  expect(encrypted).toContain("prefs=");
  expect(encrypted).not.toContain("dark");

  const clear = HttpResponse.from("ok")
    .withCookie("XSRF-TOKEN", "token-plain")
    .toFetch()
    .headers.get("Set-Cookie")!;
  expect(clear).toContain("token-plain");

  const payload = decodeURIComponent(encrypted.split("=")[1]!.split(";")[0]!);
  const req = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { cookie: `prefs=${encodeURIComponent(payload)}` },
    }),
  );
  expect(req.cookie("prefs")).toBe("dark");

  HttpResponse.flushMacros();
  resetCookieEncryptionForTests();
  Crypt.clearKey();
});

test("Response.macro and mixin", () => {
  HttpResponse.flushMacros();
  HttpResponse.macro("caps", function (this: HttpResponse, value: unknown) {
    return this.setContent(String(value).toUpperCase());
  });
  const built = (response as unknown as { caps: (v: string) => HttpResponse }).caps("hi");
  expect(built.content()).toBe("HI");

  response.mixin({
    shout(this: HttpResponse, value: unknown) {
      return this.setContent(`${String(value)}!`);
    },
  });
  expect(
    (response as unknown as { shout: (v: string) => HttpResponse }).shout("hey").content(),
  ).toBe("hey!");
  HttpResponse.flushMacros();
});

test("JsonApiResource document with include and sparse fields", async () => {
  type User = { id: number; name: string; email: string };
  type Post = { id: number; title: string; body: string; author: User };

  class UserResource extends JsonApiResource<User> {
    static type = "users";
    toAttributes() {
      return { name: this.resource.name, email: this.resource.email };
    }
  }

  class PostResource extends JsonApiResource<Post> {
    static type = "posts";
    toAttributes() {
      return { title: this.resource.title, body: this.resource.body };
    }
    toRelationships() {
      return {
        author: () => UserResource.make(this.resource.author),
      };
    }
  }

  const post = {
    id: 1,
    title: "Hello",
    body: "World",
    author: { id: 9, name: "Ada", email: "ada@example.com" },
  };

  const req = {
    url: "http://localhost/api/posts/1?include=author&fields[posts]=title&fields[users]=name",
  };
  const res = PostResource.make(post).withRequest(req).toResponse();
  expect(res.headers.get("Content-Type")).toBe("application/vnd.api+json");
  const body = (await res.json()) as {
    data: unknown;
    included: unknown;
  };
  expect(body.data).toEqual({
    type: "posts",
    id: "1",
    attributes: { title: "Hello" },
    relationships: { author: { data: { type: "users", id: "9" } } },
  });
  expect(body.included).toEqual([
    { type: "users", id: "9", attributes: { name: "Ada" } },
  ]);
});

test("JsonApiResource without include omits relationships", async () => {
  class PostResource extends JsonApiResource<{
    id: number;
    title: string;
    author: { id: number; name: string };
  }> {
    static type = "posts";
    toAttributes() {
      return { title: this.resource.title };
    }
    toRelationships() {
      return {
        author: () =>
          new (class extends JsonApiResource<{ id: number; name: string }> {
            static type = "users";
            toAttributes() {
              return { name: this.resource.name };
            }
          })(this.resource.author),
      };
    }
  }

  const body = PostResource.make({
    id: 1,
    title: "Hi",
    author: { id: 2, name: "Bob" },
  }).toDocument();
  expect((body.data as JsonApiResourceObject).relationships).toBeUndefined();
  expect(body.included).toBeUndefined();
});

test("stream writes chunks to ReadableStream body", async () => {
  const res = stream((write) => {
    write("hello ");
    write("world");
  });
  expect(await res.text()).toBe("hello world");
});

test("response.streamJson emits NDJSON lines", async () => {
  const res = response.streamJson([{ a: 1 }, { a: 2 }]);
  expect(res.headers.get("Content-Type")).toContain("ndjson");
  const text = await res.text();
  expect(text.trim().split("\n")).toEqual(['{"a":1}', '{"a":2}']);
});

test("eventStream formats SSE events", async () => {
  const res = eventStream((send) => {
    send({ ok: true }, "ready", "1");
  });
  expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  const text = await res.text();
  expect(text).toContain("event: ready");
  expect(text).toContain("id: 1");
  expect(text).toContain('data: {"ok":true}');
});

test("streamDownload sets Content-Disposition attachment", async () => {
  const res = streamDownload((write) => write("csv-data"), "export.csv", {
    "Content-Type": "text/csv",
  });
  expect(res.headers.get("Content-Disposition")).toContain("export.csv");
  expect(await res.text()).toBe("csv-data");
});

test("ip ignores X-Forwarded-For unless proxy is trusted", async () => {
  const { Request, setTrustedProxies } = await import("../src/index.ts");
  setTrustedProxies([]);

  const spoofed = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    }),
  );
  spoofed.setRemoteAddress("203.0.113.50");
  expect(spoofed.ip()).toBe("203.0.113.50");

  setTrustedProxies(["10.0.0.1"]);
  const viaProxy = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { "x-forwarded-for": "198.51.100.10, 10.0.0.1" },
    }),
  );
  viaProxy.setRemoteAddress("10.0.0.1");
  expect(viaProxy.ip()).toBe("198.51.100.10");

  setTrustedProxies("*");
  const any = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    }),
  );
  any.setRemoteAddress("192.0.2.1");
  expect(any.ip()).toBe("203.0.113.9");

  setTrustedProxies([]);
});

test("scheme and ips ignore forwarded headers unless proxy trusted", async () => {
  const { Request, setTrustedProxies } = await import("../src/index.ts");
  setTrustedProxies([]);

  const spoofed = new Request(
    new globalThis.Request("http://localhost/", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": "1.2.3.4, 10.0.0.1",
      },
    }),
  );
  spoofed.setRemoteAddress("203.0.113.50");
  expect(spoofed.scheme()).toBe("http");
  expect(spoofed.secure()).toBe(false);
  expect(spoofed.ips()).toEqual(["203.0.113.50"]);

  setTrustedProxies(["10.0.0.1"]);
  const via = new Request(
    new globalThis.Request("http://localhost/", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": "198.51.100.10, 10.0.0.1",
      },
    }),
  );
  via.setRemoteAddress("10.0.0.1");
  expect(via.scheme()).toBe("https");
  expect(via.secure()).toBe(true);
  expect(via.ips()).toEqual(["198.51.100.10", "10.0.0.1"]);

  setTrustedProxies([]);
});

test("bindRemoteAddress is picked up by Request constructor", async () => {
  const {
    Request,
    bindRemoteAddress,
    getBoundRemoteAddress,
    setTrustedProxies,
  } = await import("../src/index.ts");
  setTrustedProxies([]);

  const raw = new globalThis.Request("http://localhost/", {
    headers: { "x-forwarded-for": "1.2.3.4" },
  });
  bindRemoteAddress(raw, "203.0.113.77");
  expect(getBoundRemoteAddress(raw)).toBe("203.0.113.77");

  const req = new Request(raw);
  expect(req.remoteAddress()).toBe("203.0.113.77");
  expect(req.ip()).toBe("203.0.113.77"); // XFF ignored — proxy not trusted

  setTrustedProxies(["203.0.113.77"]);
  expect(req.ip()).toBe("1.2.3.4");
  setTrustedProxies([]);
});

test("transferTo copies remote address onto FormRequest-style target", async () => {
  const { Request, bindRemoteAddress, setTrustedProxies } = await import(
    "../src/index.ts"
  );
  setTrustedProxies([]);
  const raw = new globalThis.Request("http://localhost/");
  bindRemoteAddress(raw, "198.51.100.20");
  const source = new Request(raw);
  const target = new Request(raw);
  target.setRemoteAddress(undefined);
  source.transferTo(target);
  expect(target.ip()).toBe("198.51.100.20");
});

test("UploadedFile.storeAs rejects path traversal names", async () => {
  const { UploadedFile } = await import("../src/index.ts");
  const { LocalFilesystem, setStorage, StorageManager } = await import(
    "@bunyad/filesystem"
  );
  const { resolve } = await import("node:path");
  const { mkdir, rm } = await import("node:fs/promises");

  const root = resolve(import.meta.dir, "../.tmp-upload-sec");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  setStorage(
    new StorageManager({
      disks: { local: new LocalFilesystem({ root }) },
    }),
  );

  const file = UploadedFile.fake().create("ok.png", "x", "image/png");
  await expect(file.storeAs("uploads", "../escape.png")).rejects.toThrow(
    /Invalid upload filename/,
  );
  const path = await file.storeAs("uploads", "safe.png");
  expect(path).toBe("uploads/safe.png");
  expect(path.includes("..")).toBe(false);

  await rm(root, { recursive: true, force: true });
});


test("string @Middleware alias resolves and WithoutMiddleware strips route alias", async () => {
  const { middlewareAliasOf } = await import("./middleware-alias.ts");
  const controllerOnly = stringAliasControllerOnly();
  expect(controllerOnly).toHaveLength(1);
  expect(middlewareAliasOf(controllerOnly[0]!)).toBe("demo-throttle");
  const stack = stringAliasDemoStack();
  expect(stack).toHaveLength(1);
  // demo-auth stripped; demo-throttle from @Middleware("demo-throttle") remains
  expect(middlewareAliasOf(stack[0]!)).toBe("demo-throttle");
});

test("request input prefers body over query and supports dot keys", async () => {
  const req = new Request(
    new globalThis.Request("https://example.com/?title=query&x=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "body", user: { name: "Ada" } }),
    }),
    { id: "9" },
  );
  await req.loadJson();
  expect(req.input("title")).toBe("body");
  expect(req.all().title).toBe("body");
  expect(req.input("id")).toBe("9");
  expect(req.input("user.name")).toBe("Ada");
  expect(req.has("user.name")).toBe(true);
  expect(req.missing("user.email")).toBe(true);
  expect(req.boolean("x")).toBe(true);
});

test("response download file and noContent", async () => {
  const { mkdir, rm, writeFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const dir = resolve(import.meta.dir, "../.tmp-download");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, "hello.txt");
  await writeFile(path, "hello-bunyad");

  const dl = download(path, "greeting.txt");
  expect(dl.headers.get("Content-Disposition")).toContain("attachment");
  expect(dl.headers.get("Content-Disposition")).toContain("greeting.txt");
  expect(await dl.text()).toBe("hello-bunyad");

  const inline = response.file(path);
  expect(inline.headers.get("Content-Disposition")).toBeNull();
  expect(await inline.text()).toBe("hello-bunyad");

  const empty = response.noContent();
  expect(empty.status).toBe(204);
  expect(await empty.text()).toBe("");

  // Named exports match response.* shapes
  expect(file(path).status).toBe(200);
  expect(noContent(205).status).toBe(205);

  await rm(dir, { recursive: true, force: true });
});

test("RateLimiter shares counters via Cache.use (multi-worker)", async () => {
  const data = new Map<string, { value: unknown; expiresAt?: number }>();
  const backend = {
    async get<T>(key: string): Promise<T | undefined> {
      const row = data.get(key);
      if (!row) return undefined;
      if (row.expiresAt !== undefined && Date.now() >= row.expiresAt) {
        data.delete(key);
        return undefined;
      }
      return row.value as T;
    },
    async put(key: string, value: unknown, seconds?: number): Promise<void> {
      data.set(key, {
        value,
        expiresAt:
          seconds !== undefined ? Date.now() + seconds * 1000 : undefined,
      });
    },
    async forget(key: string): Promise<boolean> {
      return data.delete(key);
    },
  };
  const a = new RateLimiter().use(backend);
  const b = new RateLimiter().use(backend);
  await a.hit("shared-key", 60);
  expect(await b.attempts("shared-key")).toBe(1);
});

test("RateLimiter process-local Map when Cache is not bound", () => {
  const a = new RateLimiter();
  const b = new RateLimiter();
  a.hit("shared-key", 60);
  expect(a.attempts("shared-key")).toBe(1);
  expect(b.attempts("shared-key")).toBe(0);
  a.flush();
});

test("validateWithBag names the error bag the kernel flashes", async () => {
  const req = new Request(
    new globalThis.Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "" }),
    }),
  );

  const error = await req.validateWithBag("post", { title: "required" }).catch((e) => e);
  expect(error).toBeInstanceOf((await import("@bunyad/validation")).ValidationException);
  expect(error.errorBag).toBe("post");
  expect(error.errors.title[0]).toContain("required");
});

test("Limit.after counts only matching responses and blocks before the handler once exhausted", async () => {
  const { RateLimiter, Limit, throttle, Request } = await import("../src/index.ts");
  const limiter = new RateLimiter();
  limiter.for("login", () =>
    Limit.perMinute(2).by("ada").after((res) => res.status >= 400),
  );
  const mw = throttle("login", 1, { limiter });
  const req = () => new Request(new globalThis.Request("http://localhost/token", { method: "POST" }));
  let handled = 0;
  const respond = (status: number) => async () => {
    handled++;
    return json({}, status);
  };

  // Successes do not count against the limit.
  for (let i = 0; i < 5; i++) {
    expect((await mw.handle(req(), respond(200))).status).toBe(200);
  }
  // Two failures exhaust it.
  expect((await mw.handle(req(), respond(422))).status).toBe(422);
  expect((await mw.handle(req(), respond(422))).status).toBe(422);
  const before = handled;

  // The handler no longer runs, even for a request that would succeed.
  expect((await mw.handle(req(), respond(200))).status).toBe(429);
  expect(handled).toBe(before);
});
