import { JsonResource } from "@bunyad/http";
import type User from "@/Models/User.ts";

export default class UserResource extends JsonResource<User> {
  toArray() {
    return {
      id: this.resource.id,
      name: this.resource.name,
      email: this.resource.email,
    };
  }
}
