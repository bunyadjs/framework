import type { Request } from "@bunyad/http";
import type User from "@/Models/User.ts";
import UserResource from "@/Http/Resources/UserResource.ts";

export default class UserController {
  /** The user that owns the bearer token. */
  async show(request: Request) {
    return UserResource.make(request.user as User).response();
  }
}
