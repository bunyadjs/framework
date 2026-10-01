import { afterEach, expect, test } from "bun:test";
import { Request } from "@bunyad/http";
import { Session } from "@bunyad/session";
import {
  OAuth,
  OAuthUser,
  GithubProvider,
  GoogleProvider,
} from "../src/index.ts";

afterEach(() => {
  OAuth.flush();
});

test("OAuth.driver('github').redirect uses authorize URL", () => {
  OAuth.config({
    github: {
      clientId: "gid",
      clientSecret: "secret",
      redirect: "http://localhost/auth/github/callback",
    },
  });

  const session = new Session();
  const req = new Request(
    new globalThis.Request("http://localhost/login/github"),
  );
  req.session = session;
  OAuth.setRequest(req);

  const res = OAuth.driver("github").redirect();
  expect(res.status).toBe(302);
  const location = res.headers.get("Location")!;
  expect(location).toContain("https://github.com/login/oauth/authorize");
  expect(location).toContain("client_id=gid");
  expect(location).toContain(
    encodeURIComponent("http://localhost/auth/github/callback"),
  );
  expect(session.get("socialite.state")).toBeTruthy();
});

test("OAuth github user() exchanges code via fetch", async () => {
  OAuth.config({
    github: {
      clientId: "gid",
      clientSecret: "secret",
      redirect: "http://localhost/callback",
    },
  });

  const calls: string[] = [];
  OAuth.setFetch(async (url) => {
    calls.push(String(url));
    if (String(url).includes("access_token")) {
      return Response.json({
        access_token: "tok_123",
        scope: "read:user,user:email",
        token_type: "bearer",
      });
    }
    if (String(url).endsWith("/user")) {
      return Response.json({
        id: 42,
        login: "ada",
        name: "Ada Lovelace",
        email: "ada@example.com",
        avatar_url: "https://avatars.example/ada",
      });
    }
    return new Response("not found", { status: 404 });
  });

  const session = new Session();
  session.put("socialite.state", "state-1");
  const req = new Request(
    new globalThis.Request(
      "http://localhost/callback?code=abc&state=state-1",
    ),
  );
  req.session = session;
  OAuth.setRequest(req);

  const user = await OAuth.driver("github").user();
  expect(user).toBeInstanceOf(OAuthUser);
  expect(user.getId()).toBe("42");
  expect(user.getNickname()).toBe("ada");
  expect(user.getEmail()).toBe("ada@example.com");
  expect(user.getAvatar()).toContain("ada");
  expect(user.token).toBe("tok_123");
  expect(calls.some((u) => u.includes("access_token"))).toBe(true);
});

test("stateless google userFromToken maps profile", async () => {
  OAuth.config({
    google: {
      clientId: "g",
      clientSecret: "s",
      redirect: "http://localhost/cb",
    },
  });
  OAuth.setFetch(async () =>
    Response.json({
      sub: "g-1",
      name: "Grace",
      email: "grace@example.com",
      picture: "https://pic",
    }),
  );

  const user = await OAuth.driver("google")
    .stateless()
    .userFromToken("tok");
  expect(user.getId()).toBe("g-1");
  expect(user.getName()).toBe("Grace");
  expect(user.getEmail()).toBe("grace@example.com");
});

test("OAuth.extend registers custom driver", async () => {
  OAuth.config({
    custom: {
      clientId: "c",
      clientSecret: "s",
      redirect: "http://localhost/cb",
    },
  });
  OAuth.setFetch(async () =>
    Response.json({ id: 1, login: "x", name: "X", email: null, avatar_url: null }),
  );
  OAuth.extend(
    "custom",
    (config, fetchImpl) =>
      new (class extends GithubProvider {
        constructor() {
          super(config, fetchImpl);
        }
        mapUserToObject() {
          return new OAuthUser().map({
            id: "custom-1",
            name: "Custom",
          });
        }
      })(),
  );

  const user = await OAuth.driver("custom")
    .stateless()
    .userFromToken("t");
  expect(user.getId()).toBe("custom-1");
  expect(user.getName()).toBe("Custom");
});

test("GoogleProvider builds google auth URL", () => {
  const provider = new GoogleProvider({
    clientId: "g",
    clientSecret: "s",
    redirect: "http://localhost/cb",
  });
  const url = provider.getAuthUrl("st");
  expect(url).toContain("accounts.google.com");
  expect(url).toContain("client_id=g");
  expect(url).toContain("state=st");
});

test("Discord and GitLab drivers redirect", () => {
  OAuth.config({
    discord: {
      clientId: "d",
      clientSecret: "s",
      redirect: "http://localhost/discord/cb",
    },
    gitlab: {
      clientId: "gl",
      clientSecret: "s",
      redirect: "http://localhost/gitlab/cb",
      host: "https://gitlab.example.com",
    },
  });

  const session = new Session();
  const req = new Request(
    new globalThis.Request("http://localhost/login"),
  );
  req.session = session;
  OAuth.setRequest(req);

  const discord = OAuth.driver("discord").redirect();
  expect(discord.headers.get("Location")).toContain(
    "discord.com/api/oauth2/authorize",
  );

  const gitlab = OAuth.driver("gitlab").stateless().redirect();
  expect(gitlab.headers.get("Location")).toContain(
    "gitlab.example.com/oauth/authorize",
  );
});

test("scopes merges; setScopes replaces; redirectUrl overrides", () => {
  OAuth.config({
    github: {
      clientId: "gid",
      clientSecret: "secret",
      redirect: "http://localhost/old",
    },
  });
  const provider = OAuth.driver("github").stateless();
  expect(provider.getScopes()).toEqual(["read:user", "user:email"]);
  provider.scopes(["repo"]);
  expect(provider.getScopes()).toEqual(["read:user", "user:email", "repo"]);
  provider.setScopes(["public_repo"]);
  expect(provider.getScopes()).toEqual(["public_repo"]);
  provider.redirectUrl("http://localhost/new-cb");
  const location = provider.redirect().headers.get("Location")!;
  expect(location).toContain(encodeURIComponent("http://localhost/new-cb"));
  expect(location).toContain("scope=public_repo");
});
