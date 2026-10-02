import { Factory } from "@bunyad/orm";
import { Hash } from "@bunyad/auth";
import User from "@/Models/User.ts";

let sequence = 0;
// One bcrypt hash shared by every factory user.
let password: Promise<string> | undefined;

export default class UserFactory extends Factory<User> {
  model() {
    return User;
  }

  async definition() {
    sequence += 1;
    return {
      name: `User ${sequence}`,
      email: `user-${sequence}@example.com`,
      password: await (password ??= Hash.make("password")),
    };
  }
}
