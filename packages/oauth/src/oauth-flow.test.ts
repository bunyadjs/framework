import { afterEach, describe, expect, test } from "bun:test";
import { Request } from "@bunyad/http";
import { Session } from "@bunyad/session";
import {
  DiscordProvider,
  GithubProvider,
  GitlabProvider,
  OAuth,
  OAuthUser,
  type FetchLike,
} from "./index.ts";

const STATE_KEY = "socialite.state";

const githubConfig = {
  clientId: "gid",
  clientSecret: "gsecret",
  redirect: "http://localhost/callback",
};

afterEach(() => {
  OAuth.flush();
});

function callbackRequest(query: string, session?: Session): Request {
  const req = new Request(
    new globalThis.Request(`http://localhost/callback${query}`),
  );
  if (session) req.session = session;
  return req;
}

type Call = { url: string; init?: RequestInit };

function fakeGithub(calls: Call[], overrides: Partial<Record<string, Response>> = {}) {
  const impl = (async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    for (const [suffix, res] of Object.entries(overrides)) {
      if (url.endsWith(suffix)) return res!.clone();
    }
    if (url.includes("access_token")) {
      return Response.json({ access_token: "tok", token_type: "bearer" });
    }
    if (url.endsWith("/user")) {
      return Response.json({ id: 7, login: "ada", email: "ada@example.com" });
    }
    return new Response("nope", { status: 404 });
  }) as FetchLike;
  return impl;
}

describe("state handling", () => {
  test("user() without a bound request throws", async () => {
    OAuth.config({ github: githubConfig });
    await expect(OAuth.driver("github").user()).rejects.toThrow(
      /setRequest/,
    );
  });

  test("user() rejects a callback with no authorization code", async () => {
    OAuth.config({ github: githubConfig });
    const session = new Session();
    session.put(STATE_KEY, "s1");
    OAuth.setRequest(callbackRequest("?state=s1", session));
    await expect(OAuth.driver("github").user()).rejects.toThrow(
      /code is missing/,
    );
  });

  test("user() rejects a mismatched state and never hits the network", async () => {
    OAuth.config({ github: githubConfig });
    const calls: Call[] = [];
    OAuth.setFetch(fakeGithub(calls));
    const session = new Session();
    session.put(STATE_KEY, "expected");
    OAuth.setRequest(callbackRequest("?code=abc&state=forged", session));
    await expect(OAuth.driver("github").user()).rejects.toThrow(
      /Invalid OAuth state/,
    );
    expect(calls).toHaveLength(0);
  });

  test("user() rejects when the callback carries no state", async () => {
    OAuth.config({ github: githubConfig });
    const session = new Session();
    session.put(STATE_KEY, "expected");
    OAuth.setRequest(callbackRequest("?code=abc", session));
    await expect(OAuth.driver("github").user()).rejects.toThrow(
      /Invalid OAuth state/,
    );
  });

  test("user() rejects when the session has no stored state", async () => {
    OAuth.config({ github: githubConfig });
    OAuth.setRequest(callbackRequest("?code=abc&state=anything", new Session()));
    await expect(OAuth.driver("github").user()).rejects.toThrow(
      /Invalid OAuth state/,
    );
  });

  test("state is single-use: replaying the same callback fails", async () => {
    OAuth.config({ github: githubConfig });
    OAuth.setFetch(fakeGithub([]));
    const session = new Session();
    session.put(STATE_KEY, "once");
    OAuth.setRequest(callbackRequest("?code=abc&state=once", session));

    const first = await OAuth.driver("github").user();
    expect(first.getId()).toBe("7");
    await expect(OAuth.driver("github").user()).rejects.toThrow(
      /Invalid OAuth state/,
    );
  });

  test("stateless user() skips state validation entirely", async () => {
    OAuth.config({ github: githubConfig });
    OAuth.setFetch(fakeGithub([]));
    OAuth.setRequest(callbackRequest("?code=abc"));
    const user = await OAuth.driver("github").stateless().user();
    expect(user.getNickname()).toBe("ada");
  });

  test("redirect() issues a fresh state each time and stores the latest", () => {
    OAuth.config({ github: githubConfig });
    const session = new Session();
    OAuth.setRequest(callbackRequest("", session));

    const a = new URL(OAuth.driver("github").redirect().headers.get("Location")!);
    const stateA = a.searchParams.get("state");
    const b = new URL(OAuth.driver("github").redirect().headers.get("Location")!);
    const stateB = b.searchParams.get("state");

    expect(stateA).toBeTruthy();
    expect(stateB).toBeTruthy();
    expect(stateA).not.toBe(stateB);
    expect(session.get<unknown>(STATE_KEY)).toBe(stateB!);
  });

  test("stateless redirect() omits state and leaves the session untouched", () => {
    OAuth.config({ github: githubConfig });
    const session = new Session();
    OAuth.setRequest(callbackRequest("", session));
    const url = new URL(
      OAuth.driver("github").stateless().redirect().headers.get("Location")!,
    );
    expect(url.searchParams.has("state")).toBe(false);
    expect(session.get<unknown>(STATE_KEY)).toBeUndefined();
  });
});

describe("token exchange", () => {
  test("posts a form-encoded authorization_code grant", async () => {
    OAuth.config({ github: githubConfig });
    const calls: Call[] = [];
    OAuth.setFetch(fakeGithub(calls));
    OAuth.setRequest(callbackRequest("?code=the-code"));
    await OAuth.driver("github").stateless().user();

    const tokenCall = calls.find((c) => c.url.includes("access_token"))!;
    expect(tokenCall.url).toBe("https://github.com/login/oauth/access_token");
    expect(tokenCall.init?.method).toBe("POST");
    const headers = tokenCall.init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers.Accept).toBe("application/json");
    const body = new URLSearchParams(String(tokenCall.init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("client_id")).toBe("gid");
    expect(body.get("client_secret")).toBe("gsecret");
    expect(body.get("redirect_uri")).toBe("http://localhost/callback");
  });

  test("redirectUrl() override is sent as redirect_uri in the exchange", async () => {
    OAuth.config({ github: githubConfig });
    const calls: Call[] = [];
    OAuth.setFetch(fakeGithub(calls));
    OAuth.setRequest(callbackRequest("?code=c"));
    await OAuth.driver("github")
      .stateless()
      .redirectUrl("http://localhost/other")
      .user();
    const tokenCall = calls.find((c) => c.url.includes("access_token"))!;
    expect(new URLSearchParams(String(tokenCall.init?.body)).get("redirect_uri")).toBe(
      "http://localhost/other",
    );
  });

  test("a non-2xx token response throws with the status", async () => {
    OAuth.config({ github: githubConfig });
    OAuth.setFetch(
      fakeGithub([], { access_token: new Response("bad", { status: 401 }) }),
    );
    OAuth.setRequest(callbackRequest("?code=c"));
    await expect(OAuth.driver("github").stateless().user()).rejects.toThrow(
      /token request failed \(401\)/,
    );
  });

  test("a failing profile request throws a provider-specific error", async () => {
    OAuth.config({ github: githubConfig });
    OAuth.setFetch(
      fakeGithub([], { "/user": new Response("denied", { status: 403 }) }),
    );
    OAuth.setRequest(callbackRequest("?code=c"));
    await expect(OAuth.driver("github").stateless().user()).rejects.toThrow(
      /GitHub user request failed \(403\)/,
    );
  });

  test("refresh token, expiry and approved scopes are copied onto the user", async () => {
    OAuth.config({ github: githubConfig });
    OAuth.setFetch(
      fakeGithub([], {
        access_token: Response.json({
          access_token: "tok",
          refresh_token: "ref",
          expires_in: 3600,
          scope: "read:user, user:email repo",
        }),
      }),
    );
    OAuth.setRequest(callbackRequest("?code=c"));
    const user = await OAuth.driver("github").stateless().user();
    expect(user.token).toBe("tok");
    expect(user.refreshToken).toBe("ref");
    expect(user.expiresIn).toBe(3600);
    expect(user.approvedScopes).toEqual(["read:user", "user:email", "repo"]);
  });

  test("absent refresh token and scope leave null/empty defaults", async () => {
    OAuth.config({ github: githubConfig });
    OAuth.setFetch(fakeGithub([]));
    OAuth.setRequest(callbackRequest("?code=c"));
    const user = await OAuth.driver("github").stateless().user();
    expect(user.refreshToken).toBeNull();
    expect(user.expiresIn).toBeNull();
    expect(user.approvedScopes).toEqual([]);
  });
});

describe("authorize URL", () => {
  test("with() parameters are appended and may override defaults", () => {
    OAuth.config({ github: githubConfig });
    const url = new URL(
      OAuth.driver("github")
        .stateless()
        .with({ prompt: "consent", allow_signup: "false" })
        .with({ prompt: "login" })
        .redirect()
        .headers.get("Location")!,
    );
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("allow_signup")).toBe("false");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
  });

  test("scopes() ignores duplicates", () => {
    OAuth.config({ github: githubConfig });
    const p = OAuth.driver("github").scopes(["repo", "repo", "read:user"]);
    expect(p.getScopes()).toEqual(["read:user", "user:email", "repo"]);
  });

  test("getScopes() returns a copy", () => {
    OAuth.config({ github: githubConfig });
    const p = OAuth.driver("github");
    p.getScopes().push("hacked");
    expect(p.getScopes()).not.toContain("hacked");
  });
});

describe("driver resolution", () => {
  test("unconfigured provider throws a helpful error", () => {
    expect(() => OAuth.driver("github")).toThrow(/not configured/);
  });

  test("configured but unknown driver name is rejected", () => {
    OAuth.config({
      myspace: { clientId: "a", clientSecret: "b", redirect: "http://x/cb" },
    });
    expect(() => OAuth.driver("myspace")).toThrow(/Unsupported OAuth driver/);
  });

  test("config() merges across calls and later values win", () => {
    OAuth.config({ github: githubConfig });
    OAuth.config({
      discord: { clientId: "d", clientSecret: "s", redirect: "http://x/cb" },
      github: { ...githubConfig, clientId: "gid2" },
    });
    expect(OAuth.driver("discord")).toBeInstanceOf(DiscordProvider);
    const url = OAuth.driver("github").stateless().redirect().headers.get("Location")!;
    expect(url).toContain("client_id=gid2");
  });

  test("flush() clears config, custom drivers and bound request", () => {
    OAuth.config({ github: githubConfig });
    OAuth.extend("github", () => {
      throw new Error("custom used");
    });
    expect(() => OAuth.driver("github")).toThrow("custom used");
    OAuth.flush();
    expect(() => OAuth.driver("github")).toThrow(/not configured/);
  });

  test("custom driver takes precedence over the built-in of the same name", () => {
    OAuth.config({ github: githubConfig });
    OAuth.extend(
      "github",
      (config, f) => new GitlabProvider({ ...config, host: "https://gl.test" }, f),
    );
    expect(OAuth.driver("github")).toBeInstanceOf(GitlabProvider);
  });

  test("falls back to environment variables when not configured", () => {
    const keys = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_REDIRECT_URI"];
    const saved = keys.map((k) => process.env[k]);
    try {
      process.env.GITHUB_CLIENT_ID = "env-id";
      process.env.GITHUB_CLIENT_SECRET = "env-secret";
      process.env.GITHUB_REDIRECT_URI = "http://env/cb";
      const loc = OAuth.driver("github").stateless().redirect().headers.get("Location")!;
      expect(loc).toContain("client_id=env-id");
      expect(loc).toContain(encodeURIComponent("http://env/cb"));
    } finally {
      keys.forEach((k, i) => {
        if (saved[i] === undefined) delete process.env[k];
        else process.env[k] = saved[i];
      });
    }
  });

  test("incomplete environment config is treated as unconfigured", () => {
    const saved = [process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET];
    try {
      process.env.GITHUB_CLIENT_ID = "only-id";
      delete process.env.GITHUB_CLIENT_SECRET;
      expect(() => OAuth.driver("github")).toThrow(/not configured/);
    } finally {
      if (saved[0] === undefined) delete process.env.GITHUB_CLIENT_ID;
      else process.env.GITHUB_CLIENT_ID = saved[0];
      if (saved[1] !== undefined) process.env.GITHUB_CLIENT_SECRET = saved[1];
    }
  });
});

describe("providers", () => {
  test("github falls back to the verified primary email from /user/emails", async () => {
    OAuth.config({ github: githubConfig });
    OAuth.setFetch(
      fakeGithub([], {
        "/user": Response.json({ id: 1, login: "noemail", email: null }),
        "/user/emails": Response.json([
          { email: "other@x.com", primary: false, verified: true },
          { email: "unverified@x.com", primary: true, verified: false },
          { email: "main@x.com", primary: true, verified: true },
        ]),
      }),
    );
    const user = await OAuth.driver("github").stateless().userFromToken("t");
    expect(user.getEmail()).toBe("main@x.com");
  });

  test("github email lookup failure leaves email null instead of throwing", async () => {
    OAuth.config({ github: githubConfig });
    OAuth.setFetch(
      fakeGithub([], {
        "/user": Response.json({ id: 1, login: "noemail" }),
        "/user/emails": new Response("forbidden", { status: 403 }),
      }),
    );
    const user = await OAuth.driver("github").stateless().userFromToken("t");
    expect(user.getEmail()).toBeNull();
    expect(user.getId()).toBe("1");
  });

  test("github sends the bearer token on profile requests", async () => {
    OAuth.config({ github: githubConfig });
    const calls: Call[] = [];
    OAuth.setFetch(fakeGithub(calls));
    await OAuth.driver("github").stateless().userFromToken("sekret");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sekret");
  });

  test("discord builds an avatar CDN URL, or null without a hash", () => {
    const p = new DiscordProvider(githubConfig);
    const withAvatar = p.mapUserToObject({
      id: "9",
      username: "neo",
      global_name: "Neo",
      avatar: "abc",
    });
    expect(withAvatar.getAvatar()).toBe("https://cdn.discordapp.com/avatars/9/abc.png");
    expect(withAvatar.getName()).toBe("Neo");

    const bare = p.mapUserToObject({ id: "9", username: "neo", avatar: null });
    expect(bare.getAvatar()).toBeNull();
    expect(bare.getName()).toBe("neo");
  });

  test("gitlab honours a custom host and strips a trailing slash", async () => {
    const calls: Call[] = [];
    const p = new GitlabProvider(
      { ...githubConfig, host: "https://git.corp.test/" },
      async (input, init) => {
        calls.push({ url: String(input), init });
        return Response.json({ id: 5, username: "gl", name: "GL" });
      },
    );
    expect(p.getTokenUrl()).toBe("https://git.corp.test/oauth/token");
    expect(p.getAuthUrl(null)).toStartWith("https://git.corp.test/oauth/authorize?");
    const user = await p.userFromToken("t");
    expect(calls[0]!.url).toBe("https://git.corp.test/api/v4/user");
    expect(user.getNickname()).toBe("gl");
  });

  test("OAuthUser.map coerces id to string and nulls missing fields", () => {
    const u = new OAuthUser().map({ id: 12 as unknown as string });
    expect(u.getId()).toBe("12");
    expect(u.getEmail()).toBeNull();
    expect(u.getAvatar()).toBeNull();
    expect(new GithubProvider(githubConfig).mapUserToObject({}).getId()).toBe("");
  });
});
