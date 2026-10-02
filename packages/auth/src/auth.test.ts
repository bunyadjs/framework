import { beforeEach, expect, test } from "bun:test";
import { Request, json, HttpException, type Next } from "@bunyad/http";
import { Session } from "@bunyad/session";
import {
  Auth,
  Authorizable,
  Gate,
  Password,
  SessionGuard,
  TokenGuard,
  auth,
  authorize,
  can,
  guest,
  Hash,
  setAuthGuard,
  setPasswordBroker,
  setTokenGuard,
  verifyCsrf,
  preventRequestForgery,
  csrf_token,
  PasswordBroker,
  appendRememberCookie,
  AccessResponse,
  confirmPassword,
  markPasswordConfirmed,
  confirmPasswordFor,
  abilities,
  ability,
  type ApiTokenMethods,
  setDefaultGuardName,
  loginThrottleKey,
  loginLimiter,
  registerLoginLimiter,
  redirectGuestsTo,
  redirectUsersTo,
  getGuestsRedirectPath,
  getUsersRedirectPath,
  flushAuthExtensions,
  applyAuthConfig,
  setAuthEventDispatcher,
  HasApiTokens,
  setPasswordConfirmTimeout,
  getPasswordConfirmTimeout,
} from "../src/index.ts";

// Other suites boot apps whose config sets a token default guard.
beforeEach(() => setDefaultGuardName("web"));

test("session guard attempt login logout", async () => {
  const password = await Hash.make("secret");
  const users = new Map<number, { id: number; email: string; password: string }>([
    [1, { id: 1, email: "ada@example.com", password }],
  ]);

  const guard = new SessionGuard({
    retrieveById: (id) => users.get(Number(id)) ?? null,
    retrieveByCredentials: (email) =>
      [...users.values()].find((u) => u.email === email) ?? null,
  });
  setAuthGuard(guard);

  const request = new Request(new globalThis.Request("http://localhost/login", { method: "POST" }));
  request.session = new Session();

  expect(await guard.attempt(request, "ada@example.com", "wrong")).toBe(false);
  expect(await guard.check(request)).toBe(false);

  expect(await guard.attempt(request, "ada@example.com", "secret")).toBe(true);
  expect(await Auth().id(request)).toBe(1);
  expect(request.user).toEqual(users.get(1));

  await guard.logout(request);
  expect(await guard.check(request)).toBe(false);
  expect(request.user).toBeUndefined();
});

test("Hash.make and Hash.check", async () => {
  const hashed = await Hash.make("secret");
  expect(hashed.startsWith("$2")).toBe(true);
  expect(await Hash.check("secret", hashed)).toBe(true);
  expect(await Hash.check("wrong", hashed)).toBe(false);
  expect(Hash.needsRehash(hashed)).toBe(false);
  expect(Hash.needsRehash(hashed, { cost: 4 })).toBe(true);
});

test("attempt rehashes password when needsRehash", async () => {
  const weak = await Hash.make("secret", { cost: 4 });
  let persisted: string | undefined;
  const user = { id: 1, email: "ada@example.com", password: weak };
  const guard = new SessionGuard({
    retrieveById: () => user,
    retrieveByCredentials: () => user,
    updatePassword: async (_u, hashed) => {
      persisted = hashed;
      user.password = hashed;
    },
  });
  const request = new Request(new globalThis.Request("http://localhost/login"));
  request.session = new Session();
  expect(await guard.attempt(request, "ada@example.com", "secret")).toBe(true);
  expect(persisted).toBeDefined();
  expect(Hash.needsRehash(String(user.password))).toBe(false);
  expect(await Hash.check("secret", String(user.password))).toBe(true);
});

test("auth middleware redirects html guests", async () => {
  setAuthGuard(
    new SessionGuard({
      retrieveById: () => null,
      retrieveByCredentials: () => null,
    }),
  );

  const mw = auth({ loginPath: "/login" });
  const request = new Request(
    new globalThis.Request("http://localhost/dashboard", {
      headers: { accept: "text/html" },
    }),
  );
  request.session = new Session();

  const res = await mw.handle(request, (async () => json({ ok: true })) as Next);
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("/login");
  expect<unknown>(request.session.get("url.intended")).toBe(
    "http://localhost/dashboard",
  );
});

test("auth middleware redirects Inertia guests", async () => {
  setAuthGuard(
    new SessionGuard({
      retrieveById: () => null,
      retrieveByCredentials: () => null,
    }),
  );

  const mw = auth({ loginPath: "/login" });
  const request = new Request(
    new globalThis.Request("http://localhost/dashboard", {
      headers: {
        accept: "text/html, application/xhtml+xml",
        "x-inertia": "true",
      },
    }),
  );
  request.session = new Session();

  const res = await mw.handle(request, (async () => json({ ok: true })) as Next);
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("/login");
});

test("auth middleware returns 401 for json guests", async () => {
  setAuthGuard(
    new SessionGuard({
      retrieveById: () => null,
      retrieveByCredentials: () => null,
    }),
  );

  const mw = auth({ loginPath: "/login" });
  const request = new Request(
    new globalThis.Request("http://localhost/api/me", {
      headers: { accept: "application/json" },
    }),
  );
  request.session = new Session();

  const res = await mw.handle(request, (async () => json({ ok: true })) as Next);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ message: "Unauthenticated." });
});

test("guest middleware redirects authenticated users", async () => {
  const guard = new SessionGuard({
    retrieveById: (id) => ({ id, email: "a@b.c" }),
    retrieveByCredentials: () => null,
  });
  setAuthGuard(guard);

  const request = new Request(new globalThis.Request("http://localhost/login"));
  request.session = new Session();
  guard.login(request, { id: 1, email: "a@b.c" });

  const res = await guest().handle(
    request,
    (async () => json({ ok: true })) as Next,
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("/dashboard");
});

test("csrf rejects bad token and accepts header", async () => {
  const mw = verifyCsrf();
  const session = new Session();
  session.put("_token", "good");

  const bad = new Request(
    new globalThis.Request("http://localhost/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _token: "bad" }),
    }),
  );
  bad.session = session;
  const denied = await mw.handle(bad, (async () => json({ ok: true })) as Next);
  expect(denied.status).toBe(419);

  const okReq = new Request(
    new globalThis.Request("http://localhost/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "good",
      },
      body: JSON.stringify({}),
    }),
  );
  okReq.session = new Session({ _token: "good" });
  const allowed = await mw.handle(okReq, (async () => json({ ok: true })) as Next);
  expect(allowed.status).toBe(200);
  expect(allowed.headers.get("X-CSRF-TOKEN")).toBe("good");
});

test("gates and policies authorize", async () => {
  Gate.flush();
  const guard = new SessionGuard({
    retrieveById: (id) => ({ id, email: "ada@example.com" }),
    retrieveByCredentials: () => null,
  });
  setAuthGuard(guard);

  Gate.define("admin", (user) => user?.id === 1);

  class Post {
    constructor(
      readonly id: number,
      readonly user_id: number,
    ) {}
  }
  class PostPolicy {
    delete(user: { id: number } | null, post: Post) {
      return user?.id === post.user_id;
    }
  }
  Gate.policy(Post, PostPolicy);

  const request = new Request(new globalThis.Request("http://localhost/"));
  request.session = new Session();
  guard.login(request, { id: 1, email: "ada@example.com" });

  expect(await Gate.allows(request, "admin")).toBe(true);
  expect(await Gate.allows(request, "delete", new Post(9, 1))).toBe(true);
  expect(await Gate.allows(request, "delete", new Post(9, 2))).toBe(false);

  await authorize(request, "delete", new Post(9, 1));
  await expect(authorize(request, "delete", new Post(9, 2))).rejects.toThrow(
    HttpException,
  );

  const mw = can("delete", {
    resolve: () => new Post(9, 2),
  });
  await expect(
    mw.handle(request, (async () => json({ ok: true })) as Next),
  ).rejects.toThrow(HttpException);
});

test("Auth.guard token create authenticate revoke", async () => {
  const users = new Map([[1, { id: 1, email: "ada@example.com", name: "Ada" }]]);
  const tokens = new Map<
    number,
    { id: number; tokenable_id: number; name: string; token: string }
  >();
  let nextId = 1;

  const guard = new TokenGuard({
    retrieveTokenById: (id) => tokens.get(id) ?? null,
    retrieveUserById: (id) => users.get(Number(id)) ?? null,
    createTokenRecord: (data) => {
      const id = nextId++;
      tokens.set(id, {
        id,
        tokenable_id: Number(data.tokenable_id),
        name: data.name,
        token: data.token,
      });
      return id;
    },
    deleteTokenRecord: (id) => {
      tokens.delete(id);
    },
  });
  setTokenGuard(guard);

  const plain = await Auth.guard("token").createToken(users.get(1)!, "cli");
  expect(plain).toMatch(/^\d+\|[a-f0-9]+$/);

  const request = new Request(
    new globalThis.Request("http://localhost/api/me", {
      headers: { authorization: `Bearer ${plain}` },
    }),
  );
  expect(await Auth.guard("token").check(request)).toBe(true);
  expect((await Auth.guard("token").user(request))?.email).toBe(
    "ada@example.com",
  );
  expect(request.accessTokenId).toBe(1);

  await Auth.guard("token").revoke(request);
  expect(tokens.size).toBe(0);

  const again = new Request(
    new globalThis.Request("http://localhost/api/me", {
      headers: { authorization: `Bearer ${plain}` },
    }),
  );
  expect(await Auth.guard("token").check(again)).toBe(false);
});

test("Password.sendResetLink and Password.reset", async () => {
  const { Hash, Password, PasswordBroker, setPasswordBroker } = await import(
    "../src/index.ts"
  );
  const password = await Hash.make("old-secret");
  const users = new Map([
    [
      "ada@example.com",
      { id: 1, email: "ada@example.com", password },
    ],
  ]);
  const sent: { email: string; token: string; url: string }[] = [];

  setPasswordBroker(
    new PasswordBroker({
      retrieveByCredentials: (email) => users.get(email) ?? null,
      createUrl: (email, token) =>
        `https://app.test/reset?email=${email}&token=${token}`,
      sendResetNotification: (user, token, url) => {
        sent.push({ email: String(user.email), token, url });
      },
      throttle: 0,
    }),
  );

  expect(
    await Password.sendResetLink({ email: "missing@example.com" }),
  ).toBe(Password.InvalidUser);

  expect(await Password.sendResetLink({ email: "ada@example.com" })).toBe(
    Password.ResetLinkSent,
  );
  expect(sent).toHaveLength(1);
  const { token } = sent[0]!;

  expect(
    await Password.reset(
      {
        email: "ada@example.com",
        password: "new-secret",
        password_confirmation: "new-secret",
        token: "bad",
      },
      async () => {},
    ),
  ).toBe(Password.InvalidToken);

  expect(
    await Password.reset(
      {
        email: "ada@example.com",
        password: "new-secret",
        token,
      },
      async (user, plain) => {
        user.password = await Hash.make(plain);
      },
    ),
  ).toBe(Password.PasswordReset);

  expect(await Hash.check("new-secret", String(users.get("ada@example.com")!.password))).toBe(
    true,
  );
});

test("remember-me cookie restores session", async () => {
  const { Hash, SessionGuard, appendRememberCookie } = await import(
    "../src/index.ts"
  );
  const { Session } = await import("@bunyad/session");
  const { json } = await import("@bunyad/http");

  const password = await Hash.make("secret");
  const users = new Map<
    number,
    { id: number; email: string; password: string; remember_token?: string | null }
  >([
    [1, { id: 1, email: "ada@example.com", password, remember_token: null }],
  ]);

  const guard = new SessionGuard({
    retrieveById: (id) => users.get(Number(id)) ?? null,
    retrieveByCredentials: (email) =>
      [...users.values()].find((u) => u.email === email) ?? null,
    updateRememberToken: (user, token) => {
      const row = users.get(Number(user.id));
      if (row) row.remember_token = token;
    },
  });

  const loginReq = new Request(
    new globalThis.Request("http://localhost/login", { method: "POST" }),
  );
  loginReq.session = new Session();
  expect(
    await guard.attempt(loginReq, { email: "ada@example.com", password: "secret" }, true),
  ).toBe(true);

  const res = appendRememberCookie(json({ ok: true }), guard, { request: loginReq });
  const setCookie = res.headers.get("Set-Cookie")!;
  expect(setCookie).toContain("remember_web=");
  const rememberValue = decodeURIComponent(
    setCookie.split(";")[0]!.split("=")[1]!,
  );

  const next = new Request(
    new globalThis.Request("http://localhost/dashboard", {
      headers: { cookie: `remember_web=${encodeURIComponent(rememberValue)}` },
    }),
  );
  next.session = new Session();
  expect(await guard.check(next)).toBe(true);
  expect(guard.viaRemember(next)).toBe(true);
  expect(await guard.id(next)).toBe(1);

  await guard.logout(next);
  const cleared = appendRememberCookie(json({ ok: true }), guard, { request: next });
  expect(cleared.headers.get("Set-Cookie")).toContain("Max-Age=0");
});

test("email verification fulfill and verified middleware", async () => {
  const {
    Auth,
    SessionGuard,
    setAuthGuard,
    verificationHash,
    verificationUrl,
    fulfillEmailVerification,
    verified,
    mustVerifyEmailMethods,
  } = await import("../src/index.ts");
  const { Session } = await import("@bunyad/session");
  const { json } = await import("@bunyad/http");
  const { Route, Url } = await import("@bunyad/router");

  Url.setKey("verify-test-key");
  Route.clear();
  Route.get("/email/verify/{id}/{hash}", async () => json({ ok: true })).name(
    "verification.verify",
  );

  const helpers = mustVerifyEmailMethods(function (this: { email: string }) {
    return this.email;
  });

  const user = {
    id: 1,
    email: "ada@example.com",
    email_verified_at: null as string | null,
    ...helpers,
  };

  const guard = new SessionGuard({
    retrieveById: () => user,
    retrieveByCredentials: () => user,
  });
  setAuthGuard(guard);

  expect(user.hasVerifiedEmail()).toBe(false);
  expect(verificationHash(user.email)).toHaveLength(40);

  const url = await verificationUrl(user);
  expect(url).toContain("/email/verify/1/");
  expect(url).toContain(verificationHash(user.email));

  const request = new Request(new globalThis.Request(`http://localhost${url}`));
  request.session = new Session();
  guard.login(request, user);

  // Parse id/hash from path into route params
  const path = new URL(`http://localhost${url}`).pathname;
  const parts = path.split("/");
  request.setRouteParams({ id: parts[3]!, hash: parts[4]! });

  expect(await fulfillEmailVerification(request, user)).toBe(true);
  expect(user.hasVerifiedEmail()).toBe(true);
  expect(await fulfillEmailVerification(request, user)).toBe(false);

  user.email_verified_at = null;
  const mw = verified({ redirectTo: "/email/verify" });
  const htmlReq = new Request(
    new globalThis.Request("http://localhost/dashboard", {
      headers: { accept: "text/html" },
    }),
  );
  htmlReq.session = request.session;
  htmlReq.user = user;
  const blocked = await mw.handle(
    htmlReq,
    (async () => json({ ok: true })) as never,
  );
  expect(blocked.status).toBe(302);

  await user.markEmailAsVerified();
  const ok = await mw.handle(htmlReq, (async () => json({ ok: true })) as never);
  expect(ok.status).toBe(200);

  Route.clear();
});

test("Auth.validate once loginUsingId logoutOtherDevices facade", async () => {
  const password = await Hash.make("secret");
  const users = new Map<
    number,
    {
      id: number;
      email: string;
      password: string;
      remember_token?: string | null;
    }
  >([[1, { id: 1, email: "ada@example.com", password, remember_token: null }]]);

  const guard = new SessionGuard({
    retrieveById: (id) => users.get(Number(id)) ?? null,
    retrieveByCredentials: (email) =>
      [...users.values()].find((u) => u.email === email) ?? null,
    updateRememberToken: (user, token) => {
      const row = users.get(Number(user.id));
      if (row) row.remember_token = token;
    },
    updatePassword: (user, hashed) => {
      const row = users.get(Number(user.id));
      if (row) row.password = hashed;
    },
  });
  setAuthGuard(guard);

  const request = new Request(new globalThis.Request("http://localhost/"));
  request.session = new Session();

  expect(await Auth.validate({ email: "ada@example.com", password: "wrong" })).toBe(
    false,
  );
  expect(await Auth.validate({ email: "ada@example.com", password: "secret" })).toBe(
    true,
  );
  expect(Auth.getLastAttempted()?.email).toBe("ada@example.com");

  expect(await Auth.once(request, { email: "ada@example.com", password: "secret" })).toBe(
    true,
  );
  expect(await Auth.check(request)).toBe(true);
  expect(request.session.get("login_web")).toBeUndefined();

  await Auth.logout(request);
  const loggedIn = await Auth.loginUsingId(request, 1);
  expect(loggedIn).not.toBe(false);
  expect<unknown>(request.session.get("login_web")).toBe(1);

  const onceId = await Auth.onceUsingId(request, 1);
  expect(onceId).not.toBe(false);

  const rotated = await Auth.logoutOtherDevices(request, "secret");
  expect(rotated).not.toBe(false);
  expect(Hash.isHashed(String(users.get(1)!.password))).toBe(true);
  expect(users.get(1)!.remember_token).toBeTruthy();
});

test("Gate check any none before after forUser has", async () => {
  Gate.flush();
  Gate.define("edit", (user) => user?.id === 1);
  Gate.define("publish", (user) => user?.id === 1);
  Gate.define("delete", () => false);
  Gate.before((user, ability) => {
    if (user?.id === 99) return true;
    if (ability === "blocked") return false;
    return undefined;
  });
  Gate.after((_user, _ability, result) => result);

  expect(Gate.has("edit")).toBe(true);
  expect(Gate.abilities().sort()).toEqual(["delete", "edit", "publish"]);

  const request = new Request(new globalThis.Request("http://localhost/"));
  request.session = new Session();
  setAuthGuard(
    new SessionGuard({
      retrieveById: () => ({ id: 1, email: "a@b.c" }),
      retrieveByCredentials: () => null,
    }),
  );
  await Auth.loginUsingId(request, 1);

  expect(await Gate.check(request, ["edit", "publish"])).toBe(true);
  expect(await Gate.check(request, ["edit", "delete"])).toBe(false);
  expect(await Gate.any(request, ["delete", "edit"])).toBe(true);
  expect(await Gate.none(request, ["delete"])).toBe(true);

  expect(await Gate.forUser({ id: 99, email: "admin" }).allows(undefined, "edit")).toBe(
    true,
  );
  expect(await Gate.forUser(null).allows(undefined, "blocked")).toBe(false);

  Gate.flush();
});

test("Hash.isHashed and Password.tokenExists createToken", async () => {
  const hashed = await Hash.make("secret");
  expect(Hash.isHashed(hashed)).toBe(true);
  expect(Hash.isHashed("plain")).toBe(false);

  const users = new Map([["ada@example.com", { id: 1, email: "ada@example.com" }]]);
  setPasswordBroker(
    new PasswordBroker({
      retrieveByCredentials: (email) => users.get(email) ?? null,
    }),
  );

  const token = await Password.createToken("ada@example.com");
  expect(await Password.tokenExists("ada@example.com", token)).toBe(true);
  expect(await Password.tokenExists("ada@example.com", "bad")).toBe(false);
  await Password.deleteToken("ada@example.com");
  expect(await Password.tokenExists("ada@example.com", token)).toBe(false);
});

test("Auth.attemptWhen authenticate basic logoutCurrentDevice", async () => {
  const password = await Hash.make("secret");
  const users = new Map([
    [1, { id: 1, email: "ada@example.com", password, active: true }],
  ]);
  const guard = new SessionGuard({
    retrieveById: (id) => users.get(Number(id)) ?? null,
    retrieveByCredentials: (email) =>
      [...users.values()].find((u) => u.email === email) ?? null,
    updateRememberToken: () => {},
  });
  setAuthGuard(guard);

  const request = new Request(new globalThis.Request("http://localhost/"));
  request.session = new Session();

  expect(
    await Auth.attemptWhen(
      request,
      { email: "ada@example.com", password: "secret" },
      (user) => (user as { active?: boolean }).active === true,
    ),
  ).toBe(true);
  expect<unknown>(await Auth.authenticate(request)).toEqual(users.get(1));

  await Auth.logoutCurrentDevice(request);
  expect(await Auth.check(request)).toBe(false);

  const basicHeader = `Basic ${btoa("ada@example.com:secret")}`;
  const basicReq = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { authorization: basicHeader },
    }),
  );
  basicReq.session = new Session();
  expect(await Auth.basic(basicReq)).toBeNull();
  expect(await Auth.check(basicReq)).toBe(true);

  Auth.forgetUser(basicReq);
  expect(Auth.hasUser(basicReq)).toBe(false);
});

test("Gate allowIf denyIf resource raw policies", async () => {
  Gate.flush();
  class PostPolicy {
    viewAny(user: { id: number } | null) {
      return user?.id === 1;
    }
    view(user: { id: number } | null) {
      return user?.id === 1;
    }
    create() {
      return false;
    }
    update() {
      return false;
    }
    delete() {
      return false;
    }
  }
  Gate.resource("posts", PostPolicy);
  expect(Gate.has("posts.viewAny")).toBe(true);
  expect(Gate.policies().size).toBe(0);

  expect((await Gate.allowIf(true)).allowed()).toBe(true);
  expect(Gate.deny("nope").denied()).toBe(true);

  const request = new Request(new globalThis.Request("http://localhost/"));
  setAuthGuard(
    new SessionGuard({
      retrieveById: () => ({ id: 1, email: "a@b.c" }),
      retrieveByCredentials: () => null,
    }),
  );
  request.session = new Session();
  await Auth.loginUsingId(request, 1);

  expect(await Gate.raw(request, "posts.viewAny")).toBe(true);
  expect((await Gate.inspect(request, "posts.create")).denied()).toBe(true);

  let denied = false;
  try {
    await Gate.denyIf(true);
  } catch {
    denied = true;
  }
  expect(denied).toBe(true);
  Gate.flush();
});

test("Hash.info setRounds and Password.validateReset", async () => {
  Hash.setRounds(10);
  expect(Hash.cost()).toBe(10);
  const hashed = await Hash.make("secret");
  expect(Hash.info(hashed).algoName).toBe("bcrypt");
  expect(Hash.verifyConfiguration({ cost: 10 })).toBe(true);

  setPasswordBroker(
    new PasswordBroker({
      retrieveByCredentials: (email) =>
        email === "ada@example.com" ? { id: 1, email } : null,
    }),
  );
  const token = await Password.createToken("ada@example.com");
  expect(
    await Password.validateReset({
      email: "ada@example.com",
      password: "new",
      token,
    }),
  ).toBe(Password.PasswordReset);
  expect(Password.getRepository()).toBeTruthy();
});

test("TokenGuard currentAccessToken", async () => {
  const tokens = new Map<number, { id: number; tokenable_id: number; name: string; token: string }>();
  let nextId = 1;
  const guard = new TokenGuard({
    retrieveTokenById: (id) => tokens.get(id) ?? null,
    retrieveUserById: (id) => ({ id, email: "ada@example.com" }),
    createTokenRecord: (data) => {
      const id = nextId++;
      tokens.set(id, { id, ...data, tokenable_id: Number(data.tokenable_id) });
      return id;
    },
    deleteTokenRecord: (id) => {
      tokens.delete(id);
    },
  });
  setTokenGuard(guard);

  const plain = await guard.createToken({ id: 1, email: "ada@example.com" });
  const request = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { authorization: `Bearer ${plain}` },
    }),
  );
  expect(await guard.check(request)).toBe(true);
  expect(guard.currentAccessToken(request)?.tokenable_id).toBe(1);
  expect(guard.hasUser(request)).toBe(true);
  expect(await guard.validate({ token: plain })).toBe(true);
  expect(await guard.authenticate(request)).toBeTruthy();
});

test("MustVerifyEmail decorator attaches verification helpers", async () => {
  const {
    MustVerifyEmail,
    isMustVerifyEmail,
    setEmailVerificationSender,
    verificationHash,
  } = await import("../src/index.ts");
  const { Route, Url } = await import("@bunyad/router");

  Url.setKey("verify-mixin-key");
  Route.clear();
  Route.get("/email/verify/{id}/{hash}", async () => new Response("ok")).name(
    "verification.verify",
  );

  @MustVerifyEmail()
  class VerifiableUser {
    id = 1;
    email = "ada@example.com";
    email_verified_at: string | null = null;
    password = "secret";
  }

  const user = new VerifiableUser() as VerifiableUser & Record<string, (...args: any[]) => any>;
  expect(isMustVerifyEmail(user)).toBe(true);
  expect(typeof user.sendEmailVerificationNotification).toBe("function");
  expect(user.hasVerifiedEmail()).toBe(false);
  expect(user.getEmailForVerification()).toBe("ada@example.com");
  await user.markEmailAsVerified();
  expect(user.hasVerifiedEmail()).toBe(true);
  expect(user.email_verified_at).toBeTruthy();
  await user.markEmailAsUnverified();
  expect(user.hasVerifiedEmail()).toBe(false);

  let deliveredUrl: string | undefined;
  setEmailVerificationSender(async (_user, url) => {
    deliveredUrl = url;
  });
  await user.sendEmailVerificationNotification();
  expect(deliveredUrl).toContain("/email/verify/1/");
  expect(deliveredUrl).toContain(verificationHash("ada@example.com"));
  setEmailVerificationSender(undefined);
  Route.clear();
});

test("Authorizable can cannot canAny via Gate.forUser", async () => {
  Gate.flush();
  Gate.define("edit", (user) => user?.id === 1);
  Gate.define("publish", (user) => user?.id === 1);
  Gate.define("delete", () => false);

  class Post {
    constructor(
      readonly id: number,
      readonly user_id: number,
    ) {}
  }
  class PostPolicy {
    update(user: { id: number } | null, post: Post) {
      return user?.id === post.user_id;
    }
  }
  Gate.policy(Post, PostPolicy);

  class User extends Authorizable(class {}) {
    constructor(
      readonly id: number,
      readonly email: string,
    ) {
      super();
    }
  }

  const owner = new User(1, "ada@example.com");
  const other = new User(2, "bob@example.com");
  const post = new Post(9, 1);

  expect(await owner.can("edit")).toBe(true);
  expect(await owner.cannot("delete")).toBe(true);
  expect(await owner.cant("delete")).toBe(true);
  expect(await owner.can(["edit", "publish"])).toBe(true);
  expect(await owner.can(["edit", "delete"])).toBe(false);
  expect(await owner.canAny(["delete", "edit"])).toBe(true);
  expect(await owner.canAny(["delete"])).toBe(false);

  expect(await owner.can("update", post)).toBe(true);
  expect(await other.can("update", post)).toBe(false);
  expect(await other.cannot("edit")).toBe(true);

  Gate.flush();
});

test("preventRequestForgery allows same-origin without token", async () => {
  const mw = preventRequestForgery();
  const session = new Session();
  session.put("_token", "good");
  const req = new Request(
    new globalThis.Request("http://localhost/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({}),
    }),
  );
  req.session = session;
  const res = await mw.handle(req, (async () => json({ ok: true })) as Next);
  expect(res.status).toBe(200);
});

test("preventRequestForgery allowSameSite accepts same-site", async () => {
  const mw = preventRequestForgery({ allowSameSite: true });
  const session = new Session({ _token: "good" });
  const req = new Request(
    new globalThis.Request("http://localhost/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-site",
      },
      body: JSON.stringify({}),
    }),
  );
  req.session = session;
  const res = await mw.handle(req, (async () => json({ ok: true })) as Next);
  expect(res.status).toBe(200);
});

test("preventRequestForgery originOnly returns 403 without valid origin", async () => {
  const mw = preventRequestForgery({ originOnly: true });
  const session = new Session({ _token: "good" });
  const req = new Request(
    new globalThis.Request("http://localhost/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
        "x-csrf-token": "good",
      },
      body: JSON.stringify({}),
    }),
  );
  req.session = session;
  const res = await mw.handle(req, (async () => json({ ok: true })) as Next);
  expect(res.status).toBe(403);
});

test("verifyCsrf remains deprecated alias of preventRequestForgery", async () => {
  const mw = verifyCsrf();
  const session = new Session({ _token: "good" });
  const req = new Request(
    new globalThis.Request("http://localhost/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "good",
      },
      body: JSON.stringify({}),
    }),
  );
  req.session = session;
  const res = await mw.handle(req, (async () => json({ ok: true })) as Next);
  expect(res.status).toBe(200);
});

test("preventRequestForgery except supports wildcards", async () => {
  const csrf = preventRequestForgery({
    enableDuringTesting: true,
    except: ["stripe/*", "/hooks/exact"],
  });

  const post = async (path: string) => {
    const req = new Request(
      new globalThis.Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    req.session = new Session({ _token: "secret" });
    return csrf.handle(req, (async () => json({ ok: true })) as Next);
  };

  expect((await post("/stripe/webhook")).status).toBe(200);
  expect((await post("/stripe/webhook/extra")).status).toBe(200);
  expect((await post("/hooks/exact")).status).toBe(200);
  expect((await post("/other")).status).toBe(419);
});

test("login regenerates session id (session fixation)", async () => {
  const password = await Hash.make("secret");
  const users = new Map<number, { id: number; email: string; password: string }>([
    [1, { id: 1, email: "ada@example.com", password }],
  ]);

  const guard = new SessionGuard({
    retrieveById: (id) => users.get(Number(id)) ?? null,
    retrieveByCredentials: (email) =>
      [...users.values()].find((u) => u.email === email) ?? null,
  });

  const { MemorySessionStore, startSession } = await import("@bunyad/session");
  const { runPipeline } = await import("@bunyad/http");
  const store = new MemorySessionStore();
  const mw = startSession({ store, secure: false });

  // Establish anonymous session
  const anon = new Request(new globalThis.Request("http://localhost/"));
  const anonRes = await runPipeline(anon, [mw], async () => {
    anon.session!.put("guest", true);
    return new Response("<html></html>", {
      headers: { "Content-Type": "text/html" },
    });
  });
  const setCookie = anonRes.headers.get("Set-Cookie")!;
  const oldId = decodeURIComponent(setCookie.split(";")[0]!.split("=")[1]!);
  expect(oldId.length).toBeGreaterThan(0);

  // Login with that session cookie
  const login = new Request(
    new globalThis.Request("http://localhost/login", {
      method: "POST",
      headers: { cookie: `bunyad_session=${oldId}` },
    }),
  );
  const loginRes = await runPipeline(login, [mw], async () => {
    expect(await guard.attempt(login, "ada@example.com", "secret")).toBe(true);
    return new Response("<html>ok</html>", {
      headers: { "Content-Type": "text/html" },
    });
  });

  const newCookie = loginRes.headers.get("Set-Cookie");
  expect(newCookie).toBeTruthy();
  const newId = decodeURIComponent(newCookie!.split(";")[0]!.split("=")[1]!);
  expect(newId).not.toBe(oldId);

  // Old session record must not retain login key
  const oldData = await store.read(oldId);
  expect(oldData).toBeUndefined();

  const newData = await store.read(newId);
  expect(newData?.login_web).toBe(1);
});

test("logout invalidates session and clears remember cookie", async () => {
  const password = await Hash.make("secret");
  const users = new Map<
    number,
    { id: number; email: string; password: string; remember_token?: string | null }
  >([[1, { id: 1, email: "ada@example.com", password, remember_token: null }]]);

  const guard = new SessionGuard({
    retrieveById: (id) => users.get(Number(id)) ?? null,
    retrieveByCredentials: (email) =>
      [...users.values()].find((u) => u.email === email) ?? null,
    updateRememberToken: (user, token) => {
      const row = users.get(Number(user.id));
      if (row) row.remember_token = token;
    },
  });

  const request = new Request(
    new globalThis.Request("http://localhost/login", { method: "POST" }),
  );
  const session = new Session();
  request.session = session;
  const before = session.getId();
  expect(await guard.attempt(request, "ada@example.com", "secret", true)).toBe(
    true,
  );
  // regenerate may have changed id already
  expect(session.getId()).not.toBe("");

  await guard.logout(request);
  expect(await guard.check(request)).toBe(false);
  expect(request.session.get("login_web")).toBeUndefined();
  // invalidate rotates id
  expect(session.getId()).not.toBe(before);
  const pending = guard.pullRememberCookie(request);
  expect(pending).toBeNull();
});

test("session guard keeps setUser and attempts scoped to their request", async () => {
  const password = await Hash.make("secret");
  const users = [
    { id: 1, email: "ada@example.com", password },
    { id: 2, email: "grace@example.com", password: await Hash.make("other") },
  ];
  const guard = new SessionGuard({
    retrieveById: (id) => users.find((u) => u.id === Number(id)) ?? null,
    retrieveByCredentials: (email) => users.find((u) => u.email === email) ?? null,
  });
  const req = () => {
    const r = new Request(new globalThis.Request("http://localhost/login", { method: "POST" }));
    r.session = new Session();
    return r;
  };

  const impersonated = req();
  guard.setUser(impersonated, users[1]!);
  const stranger = req();
  expect(await guard.user(stranger)).toBeNull();
  expect(guard.hasUser(stranger)).toBe(false);

  const a = req();
  const b = req();
  const [okA, okB] = await Promise.all([
    guard.attempt(a, "ada@example.com", "secret"),
    guard.attempt(b, "grace@example.com", "other"),
  ]);
  expect(okA && okB).toBe(true);
  expect((a.user as { id: number }).id).toBe(1);
  expect((b.user as { id: number }).id).toBe(2);
  expect(guard.getLastAttempted(a)?.email).toBe("ada@example.com");
  expect(guard.getLastAttempted(b)?.email).toBe("grace@example.com");
});

test("remember_token is hashed at rest (SHA-256)", async () => {
  const password = await Hash.make("secret");
  const users = new Map<
    number,
    { id: number; email: string; password: string; remember_token?: string | null }
  >([[1, { id: 1, email: "ada@example.com", password, remember_token: null }]]);

  const guard = new SessionGuard({
    retrieveById: (id) => users.get(Number(id)) ?? null,
    retrieveByCredentials: (email) =>
      [...users.values()].find((u) => u.email === email) ?? null,
    updateRememberToken: (user, token) => {
      const row = users.get(Number(user.id));
      if (row) row.remember_token = token;
    },
  });

  const loginReq = new Request(
    new globalThis.Request("http://localhost/login", { method: "POST" }),
  );
  loginReq.session = new Session();
  expect(
    await guard.attempt(loginReq, { email: "ada@example.com", password: "secret" }, true),
  ).toBe(true);

  const { appendRememberCookie } = await import("../src/index.ts");
  const { json } = await import("@bunyad/http");
  const res = appendRememberCookie(json({ ok: true }), guard, { request: loginReq });
  const setCookie = res.headers.get("Set-Cookie")!;
  const rememberValue = decodeURIComponent(
    setCookie.split(";")[0]!.split("=")[1]!,
  );
  const cookieSecret = rememberValue.split("|")[1]!;
  const stored = users.get(1)!.remember_token!;
  expect(stored).not.toBe(cookieSecret);
  expect(stored.length).toBe(64); // sha256 hex

  const next = new Request(
    new globalThis.Request("http://localhost/dashboard", {
      headers: { cookie: `remember_web=${encodeURIComponent(rememberValue)}` },
    }),
  );
  next.session = new Session();
  expect(await guard.check(next)).toBe(true);

  // Tampered cookie must fail
  const bad = new Request(
    new globalThis.Request("http://localhost/dashboard", {
      headers: {
        cookie: `remember_web=${encodeURIComponent("1|deadbeef")}`,
      },
    }),
  );
  bad.session = new Session();
  expect(await guard.check(bad)).toBe(false);

  // DB hash alone must not authenticate as cookie secret
  const hashAsCookie = new Request(
    new globalThis.Request("http://localhost/dashboard", {
      headers: {
        cookie: `remember_web=${encodeURIComponent(`1|${stored}`)}`,
      },
    }),
  );
  hashAsCookie.session = new Session();
  expect(await guard.check(hashAsCookie)).toBe(false);
});

test("Auth.onceBasic authenticates without session write", async () => {
  const password = await Hash.make("secret");
  const users = new Map([
    [1, { id: 1, email: "ada@example.com", password }],
  ]);
  const guard = new SessionGuard({
    retrieveById: (id) => users.get(Number(id)) ?? null,
    retrieveByCredentials: (email) =>
      [...users.values()].find((u) => u.email === email) ?? null,
  });
  setAuthGuard(guard);

  const header = `Basic ${btoa("ada@example.com:secret")}`;
  const request = new Request(
    new globalThis.Request("http://localhost/api", {
      headers: { authorization: header },
    }),
  );
  request.session = new Session();

  expect(await Auth.onceBasic(request)).toBeNull();
  expect(await Auth.check(request)).toBe(true);
  expect(request.session.get("login_web")).toBeUndefined();
  expect(Auth.hasUser(request)).toBe(true);

  // Clear request-scoped user so the next onceBasic is not short-circuited.
  Auth.forgetUser(request);

  const bad = new Request(
    new globalThis.Request("http://localhost/api", {
      headers: { authorization: `Basic ${btoa("ada@example.com:wrong")}` },
    }),
  );
  bad.session = new Session();
  const denied = await Auth.onceBasic(bad);
  expect(denied).not.toBeNull();
  expect(denied!.status).toBe(401);
  expect(denied!.headers.get("WWW-Authenticate")).toContain("Basic");
});

test("csrf_token issues and returns session token", async () => {
  const request = new Request(new globalThis.Request("http://localhost/"));
  request.session = new Session();
  const token = csrf_token(request);
  expect(token.length).toBeGreaterThan(10);
  expect<unknown>(request.session.get("_token")).toBe(token);
  expect(csrf_token(request)).toBe(token);
});

test("remember cookie sets Secure in production", async () => {
  const password = await Hash.make("secret");
  const users = new Map<
    number,
    { id: number; email: string; password: string; remember_token?: string | null }
  >([[1, { id: 1, email: "ada@example.com", password, remember_token: null }]]);
  const guard = new SessionGuard({
    retrieveById: (id) => users.get(Number(id)) ?? null,
    retrieveByCredentials: (email) =>
      [...users.values()].find((u) => u.email === email) ?? null,
    updateRememberToken: (user, token) => {
      const row = users.get(Number(user.id));
      if (row) row.remember_token = token;
    },
  });
  const request = new Request(
    new globalThis.Request("http://localhost/login", { method: "POST" }),
  );
  request.session = new Session();
  expect(
    await guard.attempt(request, "ada@example.com", "secret", true),
  ).toBe(true);
  const prev = process.env.APP_ENV;
  process.env.APP_ENV = "production";
  try {
    const res = appendRememberCookie(json({ ok: true }), guard, { request });
    const setCookie = res.headers.get("Set-Cookie")!;
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  } finally {
    if (prev === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prev;
  }
});

test("Gate define policy tuple inspect and policy before", async () => {
  Gate.flush();
  class PostPolicy {
    before(user: { id: number } | null, ability: string) {
      if (user?.id === 99) return AccessResponse.allow("admin");
      if (ability === "delete" && user == null) {
        return AccessResponse.denyWithStatus(404, "Missing");
      }
      return null;
    }
    update(user: { id: number } | null, post: { user_id: number }) {
      if (user?.id === post.user_id) return true;
      return AccessResponse.deny("Not owner");
    }
  }
  class Post {
    user_id = 1;
  }

  Gate.define("update-post", [PostPolicy, "update"]);
  Gate.policy(Post, PostPolicy);

  const post = new Post();
  expect(
    await Gate.forUser({ id: 1 }).allows(undefined, "update-post", post),
  ).toBe(true);

  const denied = await Gate.forUser({ id: 2 }).inspect(
    undefined,
    "update-post",
    post,
  );
  expect(denied.denied()).toBe(true);
  expect(denied.message()).toBe("Not owner");

  expect(
    await Gate.forUser({ id: 99 }).allows(undefined, "update-post", post),
  ).toBe(true);

  const notFound = await Gate.forUser(null).inspect(
    undefined,
    "delete",
    post,
  );
  expect(notFound.status()).toBe(404);

  let message = "";
  try {
    await Gate.forUser({ id: 2 }).authorize(undefined, "update-post", post);
  } catch (e) {
    message = (e as Error).message;
    expect((e as { status: number }).status).toBe(403);
  }
  expect(message).toBe("Not owner");
  Gate.flush();
});

test("Auth.extend viaRequest and auth events", async () => {
  flushAuthExtensions();
  const events: string[] = [];
  setAuthEventDispatcher({
    dispatch(event) {
      events.push(event.constructor.name);
    },
  });

  const password = await Hash.make("secret");
  const user = { id: 1, email: "ada@example.com", password };
  setAuthGuard(
    new SessionGuard({
      retrieveById: () => user,
      retrieveByCredentials: (email) =>
        email === user.email ? user : null,
    }),
  );

  Auth.viaRequest("header-user", (request) => {
    const id = request.header("x-user-id");
    return id === "1" ? user : null;
  });
  Auth.extend("admin", () => Auth());

  const viaReq = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { "x-user-id": "1" },
    }),
  );
  expect(await Auth.guard("header-user").check(viaReq)).toBe(true);

  const sessionReq = new Request(
    new globalThis.Request("http://localhost/login", { method: "POST" }),
  );
  sessionReq.session = new Session();
  expect(await Auth.attempt(sessionReq, "ada@example.com", "wrong")).toBe(
    false,
  );
  expect(events).toContain("Failed");
  expect(await Auth.attempt(sessionReq, "ada@example.com", "secret")).toBe(true);
  expect(events).toContain("Login");
  await Auth.logout(sessionReq);
  expect(events).toContain("Logout");

  expect(await (Auth.guard("admin") as SessionGuard).check(sessionReq)).toBe(
    false,
  );

  setAuthEventDispatcher(null);
  flushAuthExtensions();
});

test("password.confirm middleware redirectGuestsTo and login throttle key", async () => {
  redirectGuestsTo("/sign-in");
  redirectUsersTo("/home");
  const request = new Request(new globalThis.Request("http://localhost/settings"));
  expect(getGuestsRedirectPath(request)).toBe("/sign-in");
  expect(getUsersRedirectPath(request)).toBe("/home");
  redirectGuestsTo("/login");
  redirectUsersTo("/dashboard");

  setPasswordConfirmTimeout(60);
  expect(getPasswordConfirmTimeout()).toBe(60);

  const session = new Session();
  request.session = session;
  const mw = confirmPassword({ timeout: 60 });
  const blocked = await mw.handle(request, async () => json({ ok: true }));
  expect(blocked.status).toBe(302);

  await markPasswordConfirmed(request);
  const allowed = await mw.handle(request, async () => json({ ok: true }));
  expect(await allowed.json()).toEqual({ ok: true });

  const loginReq = new Request(
    new globalThis.Request("http://localhost/login", { method: "POST" }),
  );
  loginReq.merge({ email: "Ada@Example.com" });
  expect(loginThrottleKey(loginReq)).toBe(
    `ada@example.com|${loginReq.ip()}`,
  );
  registerLoginLimiter();
  expect(loginLimiter(loginReq).maxAttempts).toBe(5);
  setPasswordConfirmTimeout(10800);
});

test("TokenGuard abilities expiry SPA cookie and HasApiTokens", async () => {
  type Row = {
    id: number;
    tokenable_id: number;
    name: string;
    token: string;
    abilities?: string;
    expires_at?: number | null;
  };
  const tokens = new Map<number, Row>();
  let nextId = 1;
  const guard = new TokenGuard({
    cookieName: "spa_token",
    retrieveTokenById: (id) => tokens.get(id) ?? null,
    retrieveUserById: (id) => ({ id, email: "ada@example.com" }),
    createTokenRecord: (data) => {
      const id = nextId++;
      tokens.set(id, {
        id,
        tokenable_id: Number(data.tokenable_id),
        name: data.name,
        token: data.token,
        abilities: data.abilities,
        expires_at: data.expires_at ?? null,
      });
      return id;
    },
    deleteTokenRecord: (id) => {
      tokens.delete(id);
    },
  });
  setTokenGuard(guard);

  const plain = await guard.createToken({ id: 1, email: "ada@example.com" }, "api", {
    abilities: ["posts:read"],
    expiresAt: 60,
  });
  const bearerReq = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { authorization: `Bearer ${plain}` },
    }),
  );
  expect(await guard.check(bearerReq)).toBe(true);
  expect(guard.tokenCan(bearerReq, "posts:read")).toBe(true);
  expect(guard.tokenCant(bearerReq, "posts:write")).toBe(true);

  const cookieReq = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { cookie: `spa_token=${plain}` },
    }),
  );
  guard.forgetUser();
  expect(await guard.check(cookieReq)).toBe(true);

  const expiredPlain = await guard.createToken(
    { id: 1, email: "ada@example.com" },
    "old",
    { abilities: ["*"], expiresAt: new Date(Date.now() - 60_000) },
  );
  const expiredReq = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { authorization: `Bearer ${expiredPlain}` },
    }),
  );
  expect(await guard.check(expiredReq)).toBe(false);

  class UserBase {
    id = 1;
    email = "ada@example.com";
  }
  class User extends HasApiTokens(UserBase, () => guard) {}
  const model = new User();
  const modelToken = await model.createToken("device", ["orders:read"]);
  expect(modelToken.includes("|")).toBe(true);

  applyAuthConfig({
    password_timeout: 120,
    guards: { admin: { driver: "session", provider: "users" } },
  });
  expect(getPasswordConfirmTimeout()).toBe(120);
  setAuthGuard(
    new SessionGuard({
      retrieveById: () => ({ id: 1, email: "a@b.c" }),
      retrieveByCredentials: () => null,
    }),
  );
  expect(Auth.guard("admin")).toBeTruthy();
  setPasswordConfirmTimeout(10800);
  flushAuthExtensions();
});

test("confirmPasswordFor rejects a wrong password and confirms the right one", async () => {
  const request = new Request(new globalThis.Request("http://localhost/settings"));
  request.session = new Session();
  const password = await Hash.make("secret");
  const guard = new SessionGuard({
    retrieveById: async () => ({ id: 1, password }),
    retrieveByCredentials: async () => null,
    validateCredentials: async () => false,
  } as never);
  setAuthGuard(guard);
  guard.setUser(request, { id: 1, password } as never);

  expect(await confirmPasswordFor(request, "wrong")).toBe(false);
  expect(request.session.passwordConfirmed?.(60)).toBeFalsy();
  expect(await confirmPasswordFor(request, "secret")).toBe(true);
  expect(request.session.passwordConfirmed?.(60)).toBeTruthy();
});

test("auth middleware answers 401 JSON for token guards without an Accept header", async () => {
  const guard = new TokenGuard({
    retrieveTokenById: async () => null,
    retrieveUserById: async () => null,
    createTokenRecord: async () => 1,
    deleteTokenRecord: async () => {},
  } as never);
  const request = new Request(new globalThis.Request("http://localhost/api/me"));
  const res = await auth({ guard }).handle(request, async () => json({ ok: true }));
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ message: "Unauthenticated." });
});

test("TokenGuard keeps token state per request, not on the guard", async () => {
  const tokens = new Map<number, { id: number; tokenable_id: number; name: string; token: string; abilities?: string }>();
  let nextId = 1;
  const users = new Map([
    [1, { id: 1, name: "ada" }],
    [2, { id: 2, name: "bob" }],
  ]);
  const guard = new TokenGuard({
    retrieveTokenById: (id) => tokens.get(id) ?? null,
    retrieveUserById: (id) => users.get(Number(id)) ?? null,
    createTokenRecord: (data) => {
      const id = nextId++;
      tokens.set(id, { id, ...data, tokenable_id: Number(data.tokenable_id) });
      return id;
    },
    deleteTokenRecord: (id) => {
      tokens.delete(id);
    },
  });
  const read = await guard.createToken(users.get(1)!, "r", ["posts:read"]);
  const write = await guard.createToken(users.get(2)!, "w", ["posts:write"]);
  const req = (token: string) =>
    new Request(
      new globalThis.Request("http://localhost/", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

  const a = req(read);
  const b = req(write);
  await Promise.all([guard.user(a), guard.user(b)]);
  expect(guard.tokenCan(a, "posts:read")).toBe(true);
  expect(guard.tokenCan(a, "posts:write")).toBe(false);
  expect(guard.tokenCan(b, "posts:write")).toBe(true);
  expect(guard.tokenCan(b, "posts:read")).toBe(false);
  expect(guard.tokenCan(a.user as object, "posts:read")).toBe(true);

  const impersonated = req("nope");
  guard.setUser(impersonated, users.get(2)! as never);
  const stranger = req("nope");
  expect(await guard.user(stranger)).toBeNull();
  expect(guard.hasUser(stranger)).toBe(false);
});

function memoryTokenGuard() {
  const tokens = new Map<number, { id: number; tokenable_id: number; name: string; token: string; abilities?: string }>();
  let nextId = 1;
  const users = new Map<number, { id: number; email: string; password?: string }>();
  const guard = new TokenGuard({
    retrieveTokenById: (id) => tokens.get(id) ?? null,
    retrieveUserById: (id) => users.get(Number(id)) ?? null,
    retrieveUserByCredentials: (credentials) =>
      [...users.values()].find((u) => u.email === credentials.email) ?? null,
    createTokenRecord: (data) => {
      const id = nextId++;
      tokens.set(id, { id, ...data, tokenable_id: Number(data.tokenable_id) });
      return id;
    },
    deleteTokenRecord: (id) => {
      tokens.delete(id);
    },
  });
  return { guard, users };
}

test("TokenGuard.attempt returns the user only for a matching password", async () => {
  const { guard, users } = memoryTokenGuard();
  users.set(1, { id: 1, email: "ada@example.com", password: await Hash.make("secret") });

  expect((await guard.attempt({ email: "ada@example.com", password: "secret" }))?.id).toBe(1);
  expect(await guard.attempt({ email: "ada@example.com", password: "nope" })).toBeNull();
  expect(await guard.attempt({ email: "who@example.com", password: "secret" })).toBeNull();
  expect(await guard.attempt({ password: "secret" })).toBeNull();
});

test("abilities and ability middleware check token abilities", async () => {
  const { guard, users } = memoryTokenGuard();
  users.set(1, { id: 1, email: "ada@example.com" });
  setTokenGuard(guard);
  const token = await guard.createToken(users.get(1)!, "t", ["posts:read", "posts:write"]);
  const req = () =>
    new Request(
      new globalThis.Request("http://localhost/", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  const ok = async () => json({ ok: true });

  expect((await abilities("posts:read", "posts:write").handle(req(), ok)).status).toBe(200);
  expect((await abilities("posts:read", "admin").handle(req(), ok)).status).toBe(403);
  expect((await ability("admin", "posts:write").handle(req(), ok)).status).toBe(200);
  expect((await ability("admin").handle(req(), ok)).status).toBe(403);

  const anonymous = new Request(new globalThis.Request("http://localhost/"));
  expect((await ability("posts:read").handle(anonymous, ok)).status).toBe(401);
});

test("auth middleware uses config defaults.guard when no guard is named", async () => {
  const { guard, users } = memoryTokenGuard();
  users.set(1, { id: 1, email: "ada@example.com" });
  setTokenGuard(guard);
  const token = await guard.createToken(users.get(1)!);
  const req = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  const ok = async () => json({ ok: true });

  applyAuthConfig({ defaults: { guard: "token" }, guards: { token: { driver: "token" } } });
  expect((await auth().handle(req, ok)).status).toBe(200);
  expect(
    (await auth().handle(new Request(new globalThis.Request("http://localhost/")), ok)).status,
  ).toBe(401);

  applyAuthConfig(undefined);
  setDefaultGuardName("web");
});

test("HasApiTokens works as a decorator and as a mixin", async () => {
  const { guard, users } = memoryTokenGuard();
  users.set(1, { id: 1, email: "ada@example.com" });
  setTokenGuard(guard);

  @HasApiTokens()
  class Decorated {
    id = 1;
    email = "ada@example.com";
  }
  interface Decorated extends ApiTokenMethods {}

  class Mixed extends HasApiTokens(
    class {
      id = 1;
      email = "ada@example.com";
    },
  ) {}

  for (const model of [new Decorated(), new Mixed()]) {
    // Methods live on the prototype, not as instance attributes.
    expect(Object.keys(model).sort()).toEqual(["email", "id"]);
    const token = await model.createToken("cli", ["posts:read"]);
    const request = new Request(
      new globalThis.Request("http://localhost/", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const user = (await guard.user(request)) as unknown as ApiTokenMethods;
    expect(user).toBeTruthy();
    expect(guard.tokenCan(request, "posts:read")).toBe(true);
    expect(guard.tokenCan(request, "posts:write")).toBe(false);
  }

  // The `guard` option picks the token guard instead of the registered one.
  const other = memoryTokenGuard();
  other.users.set(1, { id: 1, email: "ada@example.com" });
  @HasApiTokens({ guard: () => other.guard })
  class Scoped {
    id = 1;
  }
  interface Scoped extends ApiTokenMethods {}
  const token = await new Scoped().createToken();
  const request = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  const again = () =>
    new Request(
      new globalThis.Request("http://localhost/", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  expect(await other.guard.user(again())).toBeTruthy();
  expect(await guard.user(again())).toBeNull();
});

test("userProviderModel reads the default guard's provider", async () => {
  const { userProviderModel } = await import("../src/index.ts");

  expect(userProviderModel(undefined)).toBe("User");
  expect(userProviderModel({ providers: { users: { driver: "orm" } } })).toBe("User");
  expect(
    userProviderModel({
      defaults: { guard: "admin" },
      guards: { admin: { driver: "session", provider: "admins" } },
      providers: { admins: { driver: "orm", model: "Admin" } },
    }),
  ).toBe("Admin");
  expect(() =>
    userProviderModel({ providers: { users: { driver: "eloquent" as "orm" } } }),
  ).toThrow('uses driver [eloquent]. Bunyad\'s user provider driver is "orm"');
});
