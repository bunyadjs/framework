import type { Request } from "@bunyad/http";
import { Middleware, Name } from "@bunyad/http";
import { Auth, auth } from "@bunyad/auth";
import type User from "@/Models/User.ts";
import UserResource from "@/Http/Resources/UserResource.ts";

@Name("api.me")
@Middleware("throttle:api", auth({ guard: "token" }))
export default class MeController {
  async handle(request: Request) {
    const user = (await Auth.guard("token").user(request))!;
    return UserResource.make(user as User).response();
  }
}
