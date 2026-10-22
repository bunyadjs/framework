import type { Request } from "@bunyad/http";
import { Middleware } from "@bunyad/http";
import type User from "@/Models/User.ts";
import UserResource from "@/Http/Resources/UserResource.ts";

@Middleware("auth", "throttle:api")
export default class UserController {
  /** The user that owns the bearer token. */
  async show(request: Request) {
    return UserResource.make(request.user as User).response();
  }
}
