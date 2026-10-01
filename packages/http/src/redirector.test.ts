import { expect, test } from "bun:test";
import {
  redirect,
  to_route,
  Redirector,
  setRedirectUrlGenerator,
  getRedirectUrlGenerator,
  setRedirectFlashAccessor,
  getRedirectFlashAccessor,
  type RedirectUrlGenerator,
} from "../src/redirector.ts";

function withGenerator(generator: RedirectUrlGenerator, fn: () => void): void {
  const previous = getRedirectUrlGenerator();
  setRedirectUrlGenerator(generator);
  try {
    fn();
  } finally {
    setRedirectUrlGenerator(previous);
  }
}

const mock: RedirectUrlGenerator = {
  to: (path) => (path.startsWith("/") ? path : `/${path}`),
  previous: (fallback = "/") =>
    fallback.startsWith("/") ? fallback : `/${fallback}`,
  current: () => "/current",
  route: (name, params = {}) => {
    const id = params.id ?? "";
    return name === "posts.show" ? `/posts/${id}` : `/${name}`;
  },
  action: () => "/action",
};

test("redirect(path) returns a Location response", () => {
  withGenerator(mock, () => {
    const res = redirect("/login");
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });
});

test("redirect() returns a Redirector", () => {
  expect(redirect()).toBeInstanceOf(Redirector);
});

test("redirect().to away home refresh", () => {
  withGenerator(mock, () => {
    expect(redirect().to("/home", 301).headers.get("Location")).toBe("/home");
    expect(redirect().to("/home", 301).status).toBe(301);
    expect(redirect().away("https://example.com").headers.get("Location")).toBe(
      "https://example.com",
    );
    expect(redirect().home().headers.get("Location")).toBe("/");
    expect(redirect().refresh().headers.get("Location")).toBe("/current");
  });
});

test("redirect().back uses previous with fallback", () => {
  withGenerator(
    {
      ...mock,
      previous: (fallback = "/") =>
        fallback === "/" ? "/from-session" : String(fallback),
    },
    () => {
      expect(redirect().back().headers.get("Location")).toBe("/from-session");
      expect(
        redirect().back(302, {}, "/dashboard").headers.get("Location"),
      ).toBe("/dashboard");
    },
  );
});

test("redirect().route and to_route", () => {
  withGenerator(mock, () => {
    expect(
      redirect().route("posts.show", { id: 5 }).headers.get("Location"),
    ).toBe("/posts/5");
    expect(to_route("posts.show", { id: 9 }).headers.get("Location")).toBe(
      "/posts/9",
    );
  });
});

test("redirect().action", () => {
  withGenerator(mock, () => {
    class PostsController {
      show() {
        return "ok";
      }
    }
    expect(
      redirect().action([PostsController, "show"]).headers.get("Location"),
    ).toBe("/action");
  });
});

test("redirect().with / withInput / withErrors flash session", () => {
  const previous = getRedirectFlashAccessor();
  const flashed: Record<string, unknown> = {};
  setRedirectFlashAccessor(
    () => ({
      flash(key, value) {
        flashed[key] = value;
      },
    }),
    () => ({
      all: () => ({ email: "ada@example.com", password: "secret", _token: "t" }),
    }),
  );
  try {
    withGenerator(mock, () => {
      redirect("/profile").with("status", "Saved");
      expect(flashed.status).toBe("Saved");

      redirect("/profile").with({ a: 1, b: 2 });
      expect(flashed.a).toBe(1);
      expect(flashed.b).toBe(2);

      redirect().back().withInput();
      expect(flashed._old).toEqual({ email: "ada@example.com" });

      redirect("/x").withErrors({ email: ["Required"] });
      expect(flashed.errors).toEqual({ email: ["Required"] });
    });
  } finally {
    setRedirectFlashAccessor(...previous);
  }
});

test("redirect().intended uses and clears url.intended", () => {
  const previous = getRedirectFlashAccessor();
  const data: Record<string, unknown> = {
    "url.intended": "/settings",
  };
  setRedirectFlashAccessor(() => ({
    flash() {},
    pull(key, defaultValue) {
      if (!(key in data)) return defaultValue;
      const value = data[key];
      delete data[key];
      return value;
    },
  }));
  try {
    withGenerator(mock, () => {
      expect(redirect().intended("/dashboard").headers.get("Location")).toBe(
        "/settings",
      );
      expect(data["url.intended"]).toBeUndefined();
      expect(redirect().intended("/dashboard").headers.get("Location")).toBe(
        "/dashboard",
      );
    });
  } finally {
    setRedirectFlashAccessor(...previous);
  }
});
