import { JsonResource } from "@bunyad/http";
import type User from "../../Models/User.ts";

export default class UserResource extends JsonResource<User> {
  toArray() {
    return {
      id: this.resource.id,
      name: this.resource.name,
      email: this.when(Boolean(this.resource.email), this.resource.email),
      tenant_id: this.resource.tenant_id ?? null,
      ...this.mergeWhen(Number(this.resource.id) === 1, { role: "owner" }),
    };
  }
}
