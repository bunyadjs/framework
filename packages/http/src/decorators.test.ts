
import { Can as CanDecorator, controllerMiddlewareOf as middlewareOfAction } from "./decorators.ts";
import { aliasMiddleware, middlewareAliasOf as aliasOfMiddleware } from "./middleware-alias.ts";

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
