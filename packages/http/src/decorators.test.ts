import { afterAll, expect, test } from "bun:test";

import { Can as CanDecorator, controllerMiddlewareOf as middlewareOfAction } from "./decorators.ts";
import { aliasMiddleware, getMiddlewareAlias, middlewareAliasOf as aliasOfMiddleware } from "./middleware-alias.ts";

// The alias registry is global: put back the real `can` (if auth loaded it) so later test files in this process get it.
const realCan = getMiddlewareAlias("can");
afterAll(() => {
  if (realCan) aliasMiddleware("can", realCan);
});

test("@Can adds the can middleware with the ability and models", () => {
  aliasMiddleware("can", (..._params: string[]) => (_request: unknown, next: () => unknown) => next() as never);
  @CanDecorator("view", "post")
  class Posts {
    @CanDecorator("update", "post")
    update() {}
  }
  const names = middlewareOfAction(Posts, "update").map((m) => aliasOfMiddleware(m));
  expect(names).toEqual(["can:view,post", "can:update,post"]);
});
