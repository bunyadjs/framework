import { JsonResource } from "@bunyad/http";
import type User from "@/Models/User.ts";
import UserResource from "@/Http/Resources/UserResource.ts";

type IssuedToken = { token: string; user: User };

export default class TokenResource extends JsonResource<IssuedToken> {
  static wrapKey = null;

  toArray() {
    return {
      token: this.resource.token,
      token_type: "Bearer",
      user: UserResource.make(this.resource.user).toArray(),
    };
  }
}
