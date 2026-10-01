import { afterEach, expect, test } from "bun:test";
import { Request, type SessionBag } from "@bunyad/http";
import { runWithUrlContext } from "@bunyad/router";
import { Inertia, resetInertiaState, type InertiaPage } from "./index.ts";

afterEach(() => resetInertiaState());

/** An Inertia visit; `partial` names the props of a partial reload. */
function visit(url: string, headers: Record<string, string> = {}, partial?: { component: string; only: string }): Request {
  const all = new Headers({ "X-Inertia": "true", ...headers });
  if (partial) {
    all.set("X-Inertia-Partial-Component", partial.component);
    all.set("X-Inertia-Partial-Data", partial.only);
  }
  return new Request(new globalThis.Request(url, { headers: all }));
}

async function page(response: ReturnType<typeof Inertia.render>, request: Request): Promise<InertiaPage> {
  return (await (await response.toResponse(request)).json()) as InertiaPage;
}

test("merge props: append, prepend, deep merge, and rows matched by id", async () => {
  const response = () =>
    Inertia.render("feed", {
      posts: Inertia.merge(() => [{ id: 3 }]).matchOn("id"),
      notices: Inertia.merge(() => ["new"]).prepend(),
      settings: Inertia.deepMerge(() => ({ theme: { mode: "dark" } })),
      title: "Feed",
    });

  const first = await page(response(), visit("http://localhost/feed"));
  expect(first.props.posts).toEqual([{ id: 3 }]);
  expect(first.mergeProps).toEqual(["posts"]);
  expect(first.prependProps).toEqual(["notices"]);
  expect(first.deepMergeProps).toEqual(["settings"]);
  expect(first.matchPropsOn).toEqual(["posts.id"]);

  // A partial reload of one prop only marks that prop.
  const reload = await page(response(), visit("http://localhost/feed", {}, { component: "feed", only: "posts" }));
  expect(Object.keys(reload.props)).toEqual(["posts"]);
  expect(reload.mergeProps).toEqual(["posts"]);
  expect(reload.prependProps).toBeUndefined();

  // `router.reload({ reset: ["posts"] })` replaces instead of merging.
  const reset = await page(response(), visit("http://localhost/feed", { "X-Inertia-Reset": "posts" }, { component: "feed", only: "posts" }));
  expect(reset.mergeProps).toBeUndefined();
  expect(reset.matchPropsOn).toBeUndefined();
});

test("scroll props: the paginator's rows, where to go next, and the merge direction", async () => {
  const paginator = (currentPage: number, lastPage: number) => ({
    currentPage,
    options: { pageName: "page" },
    hasMorePages: () => currentPage < lastPage,
    toJSON: () => ({ data: [{ id: currentPage }], meta: { current_page: currentPage } }),
  });
  const response = (current: number) => Inertia.render("posts/index", { posts: Inertia.scroll(() => paginator(current, 3)) });

  const first = await page(response(1), visit("http://localhost/posts"));
  expect(first.props.posts).toEqual({ data: [{ id: 1 }], meta: { current_page: 1 } });
  expect(first.scrollProps).toEqual({ posts: { pageName: "page", previousPage: null, nextPage: 2, currentPage: 1, reset: false } });
  expect(first.mergeProps).toEqual(["posts.data"]);

  // <InfiniteScroll> loading upwards asks to prepend.
  const upwards = await page(
    response(2),
    visit("http://localhost/posts?page=2", { "X-Inertia-Infinite-Scroll-Merge-Intent": "prepend" }, { component: "posts/index", only: "posts" }),
  );
  expect(upwards.prependProps).toEqual(["posts.data"]);
  expect(upwards.scrollProps!.posts).toEqual({ pageName: "page", previousPage: 1, nextPage: 3, currentPage: 2, reset: false });
});

test("once props: resolved on the first visit, skipped while the client holds them", async () => {
  let resolved = 0;
  const plans = () => {
    resolved++;
    return ["basic", "pro"];
  };
  const response = () => Inertia.render("billing", { plans: Inertia.once(plans).as("billing.plans").until(60) });

  const first = await page(response(), visit("http://localhost/billing"));
  expect(first.props.plans).toEqual(["basic", "pro"]);
  expect(first.onceProps!["billing.plans"]!.prop).toBe("plans");
  expect(first.onceProps!["billing.plans"]!.expiresAt).toBeGreaterThan(Date.now());

  const again = await page(response(), visit("http://localhost/billing", { "X-Inertia-Except-Once-Props": "billing.plans" }));
  expect(again.props.plans).toBeUndefined();
  expect(again.onceProps!["billing.plans"]!.prop).toBe("plans");
  expect(resolved).toBe(1);

  // Asking for it by name resolves it again.
  await page(response(), visit("http://localhost/billing", { "X-Inertia-Except-Once-Props": "billing.plans" }, { component: "billing", only: "plans" }));
  expect(resolved).toBe(2);
});

test("shared props are listed, and flash is delivered once as the page's flash", async () => {
  Inertia.share("appName", "Bunyad");
  const values = new Map<string, unknown>();
  const session: SessionBag = {
    get: <T>(key: string, fallback?: T) => (values.has(key) ? values.get(key) : fallback) as T,
    put: (key, value) => void values.set(key, value),
    flash: (key, value) => void values.set(key, value),
    has: (key) => values.has(key),
    forget: (key) => void values.delete(key),
  };
  const request = visit("http://localhost/dashboard");
  request.session = session;

  await runWithUrlContext(async () => {
    Inertia.flash("toast", "Saved.");
    Inertia.flash({ level: "success" });
  }, { request });

  const first = await page(Inertia.render("dashboard"), request);
  expect(first.sharedProps).toEqual(["appName"]);
  expect(first.flash).toEqual({ toast: "Saved.", level: "success" });
  expect(first.props.toast).toBeUndefined();

  const second = await page(Inertia.render("dashboard"), request);
  expect(second.flash).toBeUndefined();
});
