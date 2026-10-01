import type { PasswordPlatform } from "../password.ts";

/** Bun.password adapter — bcrypt cost matches existing `hashed` cast / Hash.make. */
export const password: PasswordPlatform = {
  hash(value, options) {
    return Bun.password.hash(value, {
      algorithm: "bcrypt",
      cost: options.cost,
    });
  },
  hashSync(value, options) {
    return Bun.password.hashSync(value, {
      algorithm: "bcrypt",
      cost: options.cost,
    });
  },
  verify(value, hash) {
    return Bun.password.verify(value, hash);
  },
};
