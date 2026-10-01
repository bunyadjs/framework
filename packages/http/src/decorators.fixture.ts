import {
  Middleware,
  WithoutMiddleware,
  mergeControllerMiddleware,
} from "./decorators.ts";
import { taggedMiddleware } from "./middleware-alias.ts";

export const authMwForDecorator = taggedMiddleware("auth", {
  async handle(_request, next) {
    return next();
  },
});

export const throttleMwForDecorator = taggedMiddleware("throttle", {
  async handle(_request, next) {
    return next();
  },
});

@Middleware(throttleMwForDecorator)
@WithoutMiddleware("auth")
export class DecoratorDemoController {
  show() {}
}

export function decoratorDemoStack() {
  return mergeControllerMiddleware(
    [authMwForDecorator],
    DecoratorDemoController,
    "show",
  );
}
