import { expect, test } from "bun:test";
import {
  validate,
  ValidationException,
  setPresenceVerifier,
  Rule,
  Password,
  setCurrentPasswordVerifier,
} from "../src/index.ts";
import { Hash } from "@bunyad/auth";

test("passes required email min", async () => {
  const data = await validate(
    { email: "a@b.c", password: "secret12" },
    { email: "required|email", password: "required|min:8" },
  );
  expect(data.email).toBe("a@b.c");
});

test("fails with message bag", async () => {
  try {
    await validate({ email: "" }, { email: "required|email" });
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationException);
    expect((e as ValidationException).errors.email?.length).toBeGreaterThan(0);
  }
});

test("unique and exists rules use presence verifier", async () => {
  const rows = new Set<string>();
  setPresenceVerifier({
    exists(_table, column, value, except) {
      const key = `${column}=${value}`;
      if (except && String(except.value) === "1" && value === "keep@test") {
        return false;
      }
      return rows.has(key);
    },
  });

  rows.add("email=taken@test");

  await expect(
    validate({ email: "taken@test" }, { email: "unique:users,email" }),
  ).rejects.toBeInstanceOf(ValidationException);

  expect(
    (await validate({ email: "new@test" }, { email: "unique:users,email" }))
      .email,
  ).toBe("new@test");

  await expect(
    validate({ user_id: 99 }, { user_id: "exists:users,id" }),
  ).rejects.toBeInstanceOf(ValidationException);

  rows.add("id=1");
  expect(
    (await validate({ user_id: 1 }, { user_id: "exists:users,id" })).user_id,
  ).toBe(1);

  setPresenceVerifier(undefined);
});

test("confirmed, in, boolean, nullable, integer, between", async () => {
  const ok = await validate(
    {
      password: "secret12",
      password_confirmation: "secret12",
      role: "admin",
      active: "1",
      age: "21",
      bio: null,
    },
    {
      password: "required|confirmed|min:8",
      role: "required|in:admin,user",
      active: "boolean",
      age: "integer|between:18,65",
      bio: "nullable|string",
    },
  );
  expect(ok.role).toBe("admin");
  expect(ok.bio).toBeNull();

  await expect(
    validate(
      { password: "a", password_confirmation: "b" },
      { password: "confirmed" },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  await expect(
    validate({ role: "guest" }, { role: "in:admin,user" }),
  ).rejects.toBeInstanceOf(ValidationException);
});

test("same, different, regex, url, not_in, array, date", async () => {
  await validate(
    {
      a: "x",
      b: "x",
      c: "y",
      slug: "hello-world",
      site: "https://example.com",
      tags: ["a"],
      when: "2024-01-15",
      status: "draft",
    },
    {
      a: "same:b",
      c: "different:a",
      slug: "regex:/^[a-z0-9-]+$/",
      site: "url",
      tags: "array",
      when: "date",
      status: "not_in:published,archived",
    },
  );

  await expect(
    validate({ site: "not-a-url" }, { site: "url" }),
  ).rejects.toBeInstanceOf(ValidationException);
});

test("Validator.extend registers custom rule", async () => {
  const { Validator } = await import("../src/index.ts");
  Validator.extend("uppercase", (value) => {
    if (typeof value === "string" && value !== value.toUpperCase()) {
      return "uppercase";
    }
  });
  await expect(
    validate({ code: "abc" }, { code: "uppercase" }),
  ).rejects.toBeInstanceOf(ValidationException);
  expect(
    (await validate({ code: "ABC" }, { code: "uppercase" })).code,
  ).toBe("ABC");
});

test("nested dot attributes and array wildcards", async () => {
  const data = await validate(
    {
      user: { name: "Ada", email: "ada@example.com" },
      items: [
        { email: "a@b.c" },
        { email: "c@d.e" },
      ],
    },
    {
      "user.name": "required|string",
      "user.email": "required|email",
      "items.*.email": "required|email",
    },
  );
  expect(data).toEqual({
    user: { name: "Ada", email: "ada@example.com" },
    items: [{ email: "a@b.c" }, { email: "c@d.e" }],
  });

  try {
    await validate(
      { items: [{ email: "bad" }] },
      { "items.*.email": "required|email" },
    );
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationException);
    expect((e as ValidationException).errors["items.0.email"]?.length).toBeGreaterThan(
      0,
    );
  }
});

test("Rule helper and custom ValidationRule objects", async () => {
  const { Rule } = await import("../src/index.ts");

  const ok = await validate(
    { role: "admin", score: 10 },
    {
      role: ["required", Rule.in(["admin", "user"])],
      score: [Rule.integer(), Rule.in([10, 20])],
    },
  );
  expect(ok.role).toBe("admin");

  await expect(
    validate({ role: "guest" }, { role: Rule.in(["admin", "user"]) }),
  ).rejects.toBeInstanceOf(ValidationException);

  const odd: import("../src/index.ts").ValidationRule = {
    passes(_attribute, value) {
      return typeof value === "number" && value % 2 === 1;
    },
    message() {
      return "The value must be odd.";
    },
  };

  expect((await validate({ n: 3 }, { n: odd })).n).toBe(3);
  try {
    await validate({ n: 2 }, { n: odd });
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationException);
    expect((e as ValidationException).errors.n?.[0]).toBe(
      "The value must be odd.",
    );
  }
});

test("validate attributes rename fields in messages", async () => {
  try {
    await validate(
      { email: "" },
      { email: "required" },
      { attributes: { email: "email address" } },
    );
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationException);
    expect((e as ValidationException).errors.email?.[0]).toBe(
      "The email address field is required.",
    );
  }

  try {
    await validate(
      { email: "" },
      { email: "required" },
      {
        attributes: { email: "email address" },
        messages: { "email.required": "Please provide an :attribute." },
      },
    );
    throw new Error("expected throw");
  } catch (e) {
    expect((e as ValidationException).errors.email?.[0]).toBe(
      "Please provide an email address.",
    );
  }
});

test("Rule.unique ignore when required_if and MessageBag", async () => {
  const { Rule, validator, MessageBag } = await import("../src/index.ts");
  setPresenceVerifier({
    exists(_table, _column, _value, except) {
      // When ignoring an id, treat as not taken.
      if (except) return false;
      return true;
    },
  });

  await expect(
    validate(
      { email: "a@b.c" },
      { email: Rule.unique("users", "email").ignore(1) },
    ),
  ).resolves.toBeTruthy();

  await expect(
    validate(
      { type: "user", name: "" },
      { name: Rule.requiredIf("type", "user") },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  const ok = await validate(
    { type: "guest", name: "" },
    { name: ["nullable", Rule.requiredIf("type", "user")] },
  );
  expect(ok.name).toBeNull();

  const v = validator({ code: "abc" }, { code: "uuid" });
  expect(await v.fails()).toBe(true);
  expect(v.messages()).toBeInstanceOf(MessageBag);
  expect(v.messages().has("code")).toBe(true);
  expect(v.failed().code).toContain("uuid");

  v.addFailure("code", "custom", "Nope");
  expect(v.errors().code?.at(-1)).toBe("Nope");

  const conditional = await validate(
    { role: "admin" },
    {
      role: Rule.when(true, Rule.in(["admin"]), Rule.in(["user"])),
    },
  );
  expect(conditional.role).toBe("admin");

  setPresenceVerifier(undefined);
});

test("excludeIf and replacer", async () => {
  const { Validator, Rule } = await import("../src/index.ts");

  const excluded = await validate(
    { role_id: 5, is_admin: true },
    {
      is_admin: "boolean",
      role_id: [Rule.excludeIf(true), "integer"],
    },
  );
  expect(excluded.role_id).toBeUndefined();
  expect(excluded.is_admin).toBe(true);

  const kept = await validate(
    { role_id: 5 },
    { role_id: [Rule.excludeIf(false), "integer"] },
  );
  expect(kept.role_id).toBe(5);

  const byField = await validate(
    { has_appointment: false, appointment_date: "not-a-date" },
    {
      has_appointment: "boolean",
      appointment_date: "exclude_if:has_appointment,false|required|date",
    },
  );
  expect(byField.appointment_date).toBeUndefined();

  Validator.extend("odd", (value) => {
    if (Number(value) % 2 === 0) return "odd";
  });
  Validator.replacer("odd", (message, attribute) =>
    message.replace("invalid", `not odd (${attribute})`),
  );
  try {
    await validate({ n: 2 }, { n: "odd" });
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationException);
    expect((e as ValidationException).errors.n?.[0]).toContain("not odd");
  }
});

test("sometimes after stopOnFirstFailure alpha uuid", async () => {
  const { Validator } = await import("../src/index.ts");
  const v = Validator.make({ name: "Ada" }, { name: "required" });
  v.sometimes("bio", "required|string", (data) => data.name === "Ada");
  expect(await v.fails()).toBe(true);

  const v2 = Validator.make({ a: "", b: "" }, { a: "required", b: "required" });
  v2.stopOnFirstFailure();
  expect(await v2.fails()).toBe(true);
  expect(Object.keys(v2.errors()).length).toBe(1);

  let afterRan = false;
  const v3 = Validator.make({ x: 1 }, { x: "integer" });
  v3.after(() => {
    afterRan = true;
  });
  expect(await v3.passes()).toBe(true);
  expect(afterRan).toBe(true);
  expect(v3.validated()).toEqual({ x: 1 });

  await expect(
    validate({ slug: "Hello1" }, { slug: "alpha" }),
  ).rejects.toBeInstanceOf(ValidationException);
  expect(
    (await validate({ slug: "HelloWorld" }, { slug: "alpha" })).slug,
  ).toBe("HelloWorld");
});

test("trims strings, blanks to null, and casts by rule", async () => {
  const data = await validate(
    {
      name: "  Ada  ",
      age: "21",
      weight: "1.5",
      active: "true",
      note: "   ",
    },
    {
      name: "required|string",
      age: "integer",
      weight: "numeric",
      active: "boolean",
      note: "nullable|string",
    },
  );
  expect(data).toEqual({
    name: "Ada",
    age: 21,
    weight: 1.5,
    active: true,
    note: null,
  });
});

test("Rule.password and Password.defaults", async () => {
  Password.clearDefaults();
  Password.defaults(() =>
    Password.min(10).letters().mixedCase().numbers().symbols(),
  );

  await expect(
    validate({ password: "short" }, { password: [Rule.password()] }),
  ).rejects.toBeInstanceOf(ValidationException);

  await expect(
    validate({ password: "alllowercase1!" }, { password: [Rule.password()] }),
  ).rejects.toBeInstanceOf(ValidationException);

  const ok = await validate(
    { password: "GoodPass1!" },
    { password: [Rule.password()] },
  );
  expect(ok.password).toBe("GoodPass1!");

  Password.clearDefaults();
  const minOnly = await validate(
    { password: "12345678" },
    { password: [Password.min(8)] },
  );
  expect(minOnly.password).toBe("12345678");
});

test("current_password checks Hash against options.user", async () => {
  const hashed = await Hash.make("secret");
  setCurrentPasswordVerifier(async (plain, _guard, user) => {
    if (!user?.password) return false;
    return Hash.check(plain, String(user.password));
  });

  await expect(
    validate(
      { current: "wrong" },
      { current: Rule.currentPassword() },
      { user: { password: hashed } },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  const ok = await validate(
    { current: "secret" },
    { current: "current_password" },
    { user: { password: hashed } },
  );
  expect(ok.current).toBe("secret");

  setCurrentPasswordVerifier(null);
});

test("Rule.can / Rule.canAny via Gate ability checker", async () => {
  const { Gate } = await import("@bunyad/auth");
  const { setAbilityChecker } = await import("../src/index.ts");

  Gate.flush();
  Gate.define("update-author", (user, post, authorId) => {
    return user?.id === 1 && Number(authorId) === 42;
  });
  Gate.define("edit", (user) => user?.id === 1);
  Gate.define("publish", (user) => user?.id === 1);
  Gate.define("delete", () => false);

  setAbilityChecker(async (mode, abilities, args, user) => {
    const gate = Gate.forUser((user as { id?: number } | null) ?? null);
    if (mode === "canAny") {
      const list = Array.isArray(abilities) ? abilities : [abilities];
      return gate.any(undefined, list, ...args);
    }
    return gate.allows(undefined, String(abilities), ...args);
  });

  const user = { id: 1, email: "a@b.c" };
  const post = { id: 9 };

  const ok = await validate(
    { author: 42 },
    { author: [Rule.can("update-author", post)] },
    { user },
  );
  expect(ok.author).toBe(42);

  await expect(
    validate(
      { author: 99 },
      { author: [Rule.can("update-author", post)] },
      { user },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  const anyOk = await validate(
    { action: "x" },
    { action: [Rule.canAny(["delete", "edit"])] },
    { user },
  );
  expect(anyOk.action).toBe("x");

  await expect(
    validate(
      { action: "x" },
      { action: [Rule.canAny(["delete"])] },
      { user },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  setAbilityChecker(null);
  Gate.flush();
});

test("ascii lowercase uppercase rules", async () => {
  const ok = await validate(
    { a: "Hello", b: "hello", c: "HELLO" },
    { a: "ascii", b: "lowercase", c: "uppercase" },
  );
  expect(ok.a).toBe("Hello");

  await expect(
    validate({ a: "café" }, { a: "ascii" }),
  ).rejects.toBeInstanceOf(ValidationException);
  await expect(
    validate({ b: "Hello" }, { b: Rule.lowercase() }),
  ).rejects.toBeInstanceOf(ValidationException);
  await expect(
    validate({ c: "Hello" }, { c: Rule.uppercase() }),
  ).rejects.toBeInstanceOf(ValidationException);
});

test("Validator.make validated safe and Rule.enum", async () => {
  const { Validator, Rule } = await import("../src/index.ts");
  const v = Validator.make(
    { role: "admin", score: 10, skip: "x" },
    { role: Rule.enum({ Admin: "admin", User: "user" } as const), score: "integer" },
  );
  expect(await v.passes()).toBe(true);
  expect(v.validated()).toEqual({ role: "admin", score: 10 });
  expect(v.safe(["role"])).toEqual({ role: "admin" });
  expect(v.safe()).toEqual({ role: "admin", score: 10 });

  await expect(
    validate({ role: "guest" }, { role: Rule.enum({ A: "admin" }) }),
  ).rejects.toBeInstanceOf(ValidationException);
});

test("boolean accepts Laravel on/off/yes/no", async () => {
  const on = await validate({ a: "on", b: "yes" }, { a: "boolean", b: "boolean" });
  expect(on.a).toBe(true);
  expect(on.b).toBe(true);
  const off = await validate({ a: "off", b: "no" }, { a: "boolean", b: "boolean" });
  expect(off.a).toBe(false);
  expect(off.b).toBe(false);
});

test("file and image rules recognize UploadedFile-shaped values", async () => {
  const file = {
    size: 128,
    mimeType: "image/png",
    getClientOriginalName: () => "a.png",
    clientOriginalExtension: () => "png",
    isValid: () => true,
  };
  const ok = await validate(
    { avatar: file },
    { avatar: "required|file|image|mimes:png" },
  );
  expect(ok.avatar).toBe(file);

  await expect(
    validate({ avatar: "not-a-file" }, { avatar: "file" }),
  ).rejects.toBeInstanceOf(ValidationException);
  await expect(
    validate(
      {
        avatar: {
          ...file,
          mimeType: "application/pdf",
          getClientOriginalName: () => "a.pdf",
          clientOriginalExtension: () => "pdf",
        },
      },
      { avatar: "image" },
    ),
  ).rejects.toBeInstanceOf(ValidationException);
});

test("Rule.unique/exists where clauses reach presence verifier", async () => {
  const { Rule, presenceVerifierFor } = await import("../src/index.ts");
  const seen: Array<{
    table: string;
    column: string;
    value: unknown;
    except?: { column: string; value: unknown };
    wheres?: Array<{ column: string; value: unknown }>;
  }> = [];

  setPresenceVerifier({
    exists(table, column, value, except, wheres) {
      seen.push({ table, column, value, except, wheres });
      // Simulate tenant-scoped uniqueness: taken only when company_id=1.
      if (
        table === "users" &&
        column === "email" &&
        value === "a@b.c" &&
        wheres?.some((w) => w.column === "company_id" && w.value === 1)
      ) {
        return true;
      }
      if (table === "roles" && column === "id" && value === 5) {
        return wheres?.some((w) => w.column === "active" && w.value === 1) ?? false;
      }
      return false;
    },
  });

  await expect(
    validate(
      { email: "a@b.c" },
      { email: Rule.unique("users", "email").where("company_id", 1) },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  expect(
    (
      await validate(
        { email: "a@b.c" },
        { email: Rule.unique("users", "email").where("company_id", 2) },
      )
    ).email,
  ).toBe("a@b.c");

  expect(
    (
      await validate(
        { role_id: 5 },
        { role_id: Rule.exists("roles", "id").where("active", 1) },
      )
    ).role_id,
  ).toBe(5);

  await expect(
    validate(
      { role_id: 5 },
      { role_id: Rule.exists("roles", "id").where("active", 0) },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  expect(seen.some((s) => s.wheres?.length)).toBe(true);
  setPresenceVerifier(undefined);

  // presenceVerifierFor emits LIMIT 1 + bound where columns (no COUNT(*)).
  const sqls: string[] = [];
  const verifier = presenceVerifierFor({
    get(sql, params) {
      sqls.push(sql);
      expect(params?.[0]).toBe("x");
      expect(params?.[1]).toBe(9);
      return { c: 1 };
    },
  });
  expect(await verifier.exists("users", "email", "x", undefined, [{ column: "tenant_id", value: 9 }])).toBe(true);
  expect(sqls[0]).toContain("SELECT 1");
  expect(sqls[0]).toContain("LIMIT 1");
  expect(sqls[0]).toContain("tenant_id = ?");
  expect(sqls[0]).not.toContain("COUNT(*)");

  await expect(
    verifier.exists("users;drop", "email", "x"),
  ).rejects.toThrow(/Invalid unique\/exists identifier/);
});

test("accepted, declined, accepted_if, declined_if", async () => {
  expect((await validate({ terms: "yes" }, { terms: "accepted" })).terms).toBe(
    "yes",
  );
  expect((await validate({ terms: true }, { terms: "accepted" })).terms).toBe(
    true,
  );
  expect((await validate({ terms: "1" }, { terms: Rule.accepted() })).terms).toBe(
    "1",
  );

  await expect(
    validate({ terms: "no" }, { terms: "accepted" }),
  ).rejects.toBeInstanceOf(ValidationException);

  expect((await validate({ opt: "no" }, { opt: "declined" })).opt).toBe("no");
  expect((await validate({ opt: 0 }, { opt: Rule.declined() })).opt).toBe(0);
  await expect(
    validate({ opt: "yes" }, { opt: "declined" }),
  ).rejects.toBeInstanceOf(ValidationException);

  await validate(
    { role: "admin", terms: "on" },
    { terms: "accepted_if:role,admin" },
  );
  await validate(
    { role: "user", terms: "no" },
    { terms: Rule.acceptedIf("role", "admin") },
  );
  await expect(
    validate({ role: "admin", terms: "no" }, { terms: "accepted_if:role,admin" }),
  ).rejects.toBeInstanceOf(ValidationException);

  await validate(
    { newsletter: "1", opt_out: "off" },
    { opt_out: "declined_if:newsletter,1" },
  );
  await expect(
    validate(
      { newsletter: "1", opt_out: "yes" },
      { opt_out: Rule.declinedIf("newsletter", "1") },
    ),
  ).rejects.toBeInstanceOf(ValidationException);
});

test("after, before, after_or_equal, before_or_equal, date_equals, date_format", async () => {
  await validate(
    { start: "2024-01-01", end: "2024-01-15" },
    { end: "after:start" },
  );
  await validate({ end: "2024-06-01" }, { end: Rule.after("2024-01-01") });
  await expect(
    validate(
      { start: "2024-01-15", end: "2024-01-01" },
      { end: "after:start" },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  await validate(
    { start: "2024-01-15", end: "2024-01-15" },
    { end: "after_or_equal:start" },
  );
  await expect(
    validate(
      { start: "2024-01-15", end: "2024-01-01" },
      { end: Rule.afterOrEqual("start") },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  await validate(
    { start: "2024-01-01", end: "2024-01-15" },
    { start: "before:end" },
  );
  await expect(
    validate(
      { start: "2024-01-15", end: "2024-01-01" },
      { start: Rule.before("end") },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  await validate(
    { start: "2024-01-15", end: "2024-01-15" },
    { start: "before_or_equal:end" },
  );
  await expect(
    validate(
      { start: "2024-01-16", end: "2024-01-15" },
      { start: Rule.beforeOrEqual("end") },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  await validate(
    { day: "2024-01-15" },
    { day: "date_equals:2024-01-15" },
  );
  await expect(
    validate({ day: "2024-01-16" }, { day: Rule.dateEquals("2024-01-15") }),
  ).rejects.toBeInstanceOf(ValidationException);

  await validate({ day: "2024-01-15" }, { day: "date_format:Y-m-d" });
  await validate(
    { day: "15/01/2024" },
    { day: Rule.dateFormat("d/m/Y") },
  );
  await expect(
    validate({ day: "01-15-2024" }, { day: "date_format:Y-m-d" }),
  ).rejects.toBeInstanceOf(ValidationException);
});

test("gt, gte, lt, lte compare fields and numeric values", async () => {
  expect(
    (await validate({ age: 21 }, { age: "numeric|gt:18" })).age,
  ).toBe(21);
  expect(
    (await validate({ age: 18 }, { age: "numeric|gte:18" })).age,
  ).toBe(18);
  await expect(
    validate({ age: 17 }, { age: "numeric|gt:18" }),
  ).rejects.toBeInstanceOf(ValidationException);

  await validate(
    { min: 10, max: 20 },
    { max: "numeric|gt:min", min: "numeric|lt:max" },
  );
  await expect(
    validate({ min: 20, max: 10 }, { max: Rule.gt("min") }),
  ).rejects.toBeInstanceOf(ValidationException);

  expect(
    (await validate({ n: 5 }, { n: "numeric|lte:5" })).n,
  ).toBe(5);
  expect(
    (await validate({ n: 4 }, { n: Rule.lt(5) })).n,
  ).toBe(4);
  await expect(
    validate({ n: 6 }, { n: "numeric|lte:5" }),
  ).rejects.toBeInstanceOf(ValidationException);

  // Strings without numeric: compare by length.
  await validate({ a: "abcd", b: "ab" }, { a: "gt:b" });
  await expect(
    validate({ a: "a", b: "ab" }, { a: Rule.gte("b") }),
  ).rejects.toBeInstanceOf(ValidationException);
});

test("acceptance and date rules emit lang messages; defaults override", async () => {
  const { Validator, addDefaultMessages, resetDefaultMessages } = await import(
    "../src/index.ts"
  );

  try {
    await validate({ terms: "no" }, { terms: "accepted" });
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationException);
    expect((e as ValidationException).errors.terms?.[0]).toBe(
      "The terms field must be accepted.",
    );
  }

  try {
    await validate({ day: "bad" }, { day: "date_format:Y-m-d" });
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationException);
    expect((e as ValidationException).errors.day?.[0]).toContain(
      "format Y-m-d",
    );
  }

  try {
    await validate(
      { role: "admin", terms: "no" },
      { terms: "accepted_if:role,admin" },
    );
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationException);
    expect((e as ValidationException).errors.terms?.[0]).toContain(
      "when role is admin",
    );
  }

  addDefaultMessages({ accepted: "Please accept :attribute." });
  try {
    await validate({ terms: "no" }, { terms: "accepted" });
    throw new Error("expected throw");
  } catch (e) {
    expect((e as ValidationException).errors.terms?.[0]).toBe(
      "Please accept terms.",
    );
  }

  Validator.setDefaultMessages({
    ...((await import("../src/lang/en/validation.ts")).default),
    declined: "Must decline :attribute.",
  });
  try {
    await validate({ opt: "yes" }, { opt: "declined" });
    throw new Error("expected throw");
  } catch (e) {
    expect((e as ValidationException).errors.opt?.[0]).toBe(
      "Must decline opt.",
    );
  }

  resetDefaultMessages();
  try {
    await validate({ opt: "yes" }, { opt: "declined" });
    throw new Error("expected throw");
  } catch (e) {
    expect((e as ValidationException).errors.opt?.[0]).toBe(
      "The opt field must be declined.",
    );
  }
});

test("digits affixes formats arrays presence prohibit exclude pipes", async () => {
  const {
    setActiveUrlChecker,
    resetDefaultMessages,
  } = await import("../src/index.ts");
  resetDefaultMessages();

  expect((await validate({ pin: "1234" }, { pin: "digits:4" })).pin).toBe("1234");
  await expect(validate({ pin: "12" }, { pin: "digits:4" })).rejects.toBeInstanceOf(
    ValidationException,
  );
  expect(
    (await validate({ pin: "123" }, { pin: "digits_between:2,4" })).pin,
  ).toBe("123");
  expect((await validate({ price: "9.99" }, { price: "decimal:2" })).price).toBe(
    "9.99",
  );
  await expect(
    validate({ price: "9.9" }, { price: "decimal:2" }),
  ).rejects.toBeInstanceOf(ValidationException);
  expect((await validate({ n: 10 }, { n: "multiple_of:5" })).n).toBe(10);
  await expect(
    validate({ n: 7 }, { n: "multiple_of:5" }),
  ).rejects.toBeInstanceOf(ValidationException);

  expect(
    (await validate({ s: "foobar" }, { s: "starts_with:foo,bar" })).s,
  ).toBe("foobar");
  await expect(
    validate({ s: "baz" }, { s: "starts_with:foo" }),
  ).rejects.toBeInstanceOf(ValidationException);
  expect((await validate({ s: "xfoo" }, { s: "ends_with:foo" })).s).toBe("xfoo");
  expect(
    (await validate({ s: "hello" }, { s: "doesnt_start_with:x,y" })).s,
  ).toBe("hello");
  await expect(
    validate({ s: "xhello" }, { s: "doesnt_start_with:x" }),
  ).rejects.toBeInstanceOf(ValidationException);
  expect(
    (await validate({ s: "hello" }, { s: "doesnt_end_with:x" })).s,
  ).toBe("hello");

  expect((await validate({ c: "#fff" }, { c: "hex_color" })).c).toBe("#fff");
  expect((await validate({ c: "#aabbcc" }, { c: "hex_color" })).c).toBe(
    "#aabbcc",
  );
  await expect(
    validate({ c: "fff" }, { c: "hex_color" }),
  ).rejects.toBeInstanceOf(ValidationException);
  expect(
    (await validate({ m: "00:1A:2B:3C:4D:5E" }, { m: "mac_address" })).m,
  ).toBe("00:1A:2B:3C:4D:5E");
  await expect(
    validate({ m: "not-mac" }, { m: "mac_address" }),
  ).rejects.toBeInstanceOf(ValidationException);
  expect(
    (await validate({ tz: "UTC" }, { tz: "timezone" })).tz,
  ).toBe("UTC");
  expect(
    (await validate({ tz: "America/New_York" }, { tz: "timezone" })).tz,
  ).toBe("America/New_York");
  await expect(
    validate({ tz: "Not/AZone" }, { tz: "timezone" }),
  ).rejects.toBeInstanceOf(ValidationException);

  setActiveUrlChecker(async (host) => host === "example.com");
  expect(
    (
      await validate(
        { u: "https://example.com/path" },
        { u: "active_url" },
      )
    ).u,
  ).toBe("https://example.com/path");
  await expect(
    validate({ u: "https://missing.invalid" }, { u: "active_url" }),
  ).rejects.toBeInstanceOf(ValidationException);
  setActiveUrlChecker(undefined);

  expect(
    (
      await validate(
        { items: [{ id: 1 }, { id: 2 }] },
        { "items.*.id": "distinct" },
      )
    ).items,
  ).toEqual([{ id: 1 }, { id: 2 }]);
  await expect(
    validate(
      { items: [{ id: 1 }, { id: 1 }] },
      { "items.*.id": "distinct" },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  expect((await validate({ tags: [1, 2] }, { tags: "list" })).tags).toEqual([
    1, 2,
  ]);
  await expect(
    validate({ tags: { a: 1 } }, { tags: "list" }),
  ).rejects.toBeInstanceOf(ValidationException);

  expect(
    (
      await validate(
        { user: { name: "Ada", email: "a@b.c" } },
        { user: "required_array_keys:name,email" },
      )
    ).user,
  ).toEqual({ name: "Ada", email: "a@b.c" });
  await expect(
    validate({ user: { name: "Ada" } }, { user: "required_array_keys:name,email" }),
  ).rejects.toBeInstanceOf(ValidationException);

  await expect(
    validate({ role: "admin" }, { name: "present_if:role,admin" }),
  ).rejects.toBeInstanceOf(ValidationException);
  expect(
    (
      await validate(
        { role: "admin", name: null },
        { name: "present_if:role,admin", role: "string" },
      )
    ).name,
  ).toBeNull();

  await expect(
    validate(
      { a: 1, b: 2 },
      { a: "string", b: "missing_with:a" },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  await expect(
    validate({ x: "nope", type: "guest" }, { x: "prohibited_unless:type,admin", type: "string" }),
  ).rejects.toBeInstanceOf(ValidationException);
  expect(
    (
      await validate(
        { x: "ok", type: "admin" },
        { x: "prohibited_unless:type,admin", type: "string" },
      )
    ).x,
  ).toBe("ok");

  await expect(
    validate(
      { a: "1", b: "2" },
      { a: "prohibits:b", b: "string" },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  const excluded = await validate(
    { note: "x", flag: true },
    { note: "exclude|string", flag: "boolean" },
  );
  expect(excluded.note).toBeUndefined();
  expect(excluded.flag).toBe(true);

  const withEx = await validate(
    { a: 1, b: "drop" },
    { a: "integer", b: "exclude_with:a|string" },
  );
  expect(withEx.b).toBeUndefined();

  const withoutEx = await validate(
    { b: "drop" },
    { b: "exclude_without:a|string" },
  );
  expect(withoutEx.b).toBeUndefined();

  // sometimes pipe: missing attribute skips required
  expect(
    await validate({}, { bio: "sometimes|required|string" }),
  ).toEqual({});
  await expect(
    validate({ bio: "" }, { bio: "sometimes|required|string" }),
  ).rejects.toBeInstanceOf(ValidationException);

  // bail pipe: stop after first failure on the attribute
  try {
    await validate({ x: "ab" }, { x: "bail|min:5|max:1" });
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationException);
    expect((e as ValidationException).errors.x?.length).toBe(1);
  }

  Password.clearDefaults();
  Password.defaults(() => Password.min(10).letters());
  await expect(
    validate({ password: "short" }, { password: "password" }),
  ).rejects.toBeInstanceOf(ValidationException);
  expect(
    (
      await validate(
        { password: "longenough" },
        { password: "password" },
      )
    ).password,
  ).toBe("longenough");
  Password.clearDefaults();
});

test("Rule.unique where callback and whereNull", async () => {
  const seen: Array<{ wheres?: Array<{ column: string; value: unknown; operator?: string }> }> =
    [];
  setPresenceVerifier({
    exists(_table, _column, _value, _except, wheres) {
      seen.push({ wheres });
      return wheres?.some((w) => w.operator === "null" && w.column === "deleted_at") ?? false;
    },
  });

  await expect(
    validate(
      { email: "a@b.c" },
      {
        email: Rule.unique("users", "email").where((q) =>
          q.where("company_id", 1).whereNull("deleted_at"),
        ),
      },
    ),
  ).rejects.toBeInstanceOf(ValidationException);

  expect(
    (
      await validate(
        { email: "a@b.c" },
        { email: Rule.exists("users", "email").whereNull("deleted_at") },
      )
    ).email,
  ).toBe("a@b.c");

  expect(
    seen.some((s) =>
      s.wheres?.some((w) => w.column === "deleted_at" && w.operator === "null"),
    ),
  ).toBe(true);

  const sqls: string[] = [];
  const { presenceVerifierFor } = await import("../src/index.ts");
  const verifier = presenceVerifierFor({
    get(sql) {
      sqls.push(sql);
      return { c: 1 };
    },
  });
  await verifier.exists("users", "email", "x", undefined, [
    { column: "deleted_at", value: null, operator: "null" },
  ]);
  expect(sqls[0]).toContain("deleted_at IS NULL");
  expect(sqls[0]).not.toContain("deleted_at = ?");

  setPresenceVerifier(undefined);
});

test("ValidationException.withMessages wraps strings into arrays", () => {
  const error = ValidationException.withMessages({
    email: "Bad credentials.",
    name: ["Too short.", "Reserved."],
  });
  expect(error.errors).toEqual({
    email: ["Bad credentials."],
    name: ["Too short.", "Reserved."],
  });
  expect(error.message).toBe("The given data was invalid.");
});
