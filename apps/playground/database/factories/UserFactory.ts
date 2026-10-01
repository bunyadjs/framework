import { Factory } from "@bunyad/orm";
import { Hash } from "@bunyad/auth";
import User from "../../app/Models/User.ts";

let sequence = 0;

export default class UserFactory extends Factory<User> {
  model() {
    return User;
  }

  async definition() {
    sequence += 1;
    return {
      name: `User ${sequence}`,
      email: `user-${sequence}@example.com`,
      password: await Hash.make("password"),
      tenant_id: "demo",
    };
  }
}
