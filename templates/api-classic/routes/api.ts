import { Route, type Router } from "@bunyad/router";
import RegisterController from "@/Http/Controllers/Auth/RegisterController.ts";
import TokenController from "@/Http/Controllers/Auth/TokenController.ts";
import UserController from "@/Http/Controllers/UserController.ts";

/**
 * API routes. `loadRouteModule` wraps this file in the `api` middleware group
 * and the `/api` prefix.
 */
export default function (router: Router = Route): void {
  Route.post("/register", RegisterController)
    .middleware("throttle:tokens")
    .name("api.register");

  Route.post("/token", [TokenController, "store"])
    .middleware("throttle:token")
    .name("api.token.store");

  Route.middleware("auth", "throttle:api").group(() => {
    Route.get("/me", [UserController, "show"]).name("api.me");
    Route.delete("/token", [TokenController, "destroy"]).name("api.token.destroy");
  });
}
