import {
  Middleware,
  WithoutMiddleware,
  mergeControllerMiddleware,
  controllerMiddlewareOf,
} from "./decorators.ts";
import {
  aliasMiddleware,
  taggedMiddleware,
  resolveMiddleware,
} from "./middleware-alias.ts";
import type { Middleware as MiddlewareType } from "./pipeline.ts";

aliasMiddleware("demo-auth", () =>
  taggedMiddleware("demo-auth", {
    async handle(_request, next) {
      return next();
    },
  }),
);

aliasMiddleware("demo-throttle", () =>
  taggedMiddleware("demo-throttle", {
    async handle(_request, next) {
      return next();
    },
  }),
);

@Middleware("demo-throttle")
@WithoutMiddleware("demo-auth")
export class StringAliasController {
  show() {}
}

/** Route stack uses resolved aliases; controller uses string @Middleware. */
export function stringAliasDemoStack(): MiddlewareType[] {
  const routeMw = [resolveMiddleware("demo-auth")];
  return mergeControllerMiddleware(
    routeMw,
    StringAliasController,
    "show",
  );
}

export function stringAliasControllerOnly() {
  return controllerMiddlewareOf(StringAliasController, "show");
}
