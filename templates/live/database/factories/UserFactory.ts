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
      email_verified_at: new Date(),
      password: await (password ??= Hash.make("password")),
    };
  }

  /** The user has not verified their email address. */
  unverified(): this {
    return this.state({ email_verified_at: null });
  }
}
