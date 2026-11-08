import { beforeAll, expect, test } from "bun:test";
import { Crypt } from "@bunyad/common";
import {
  TwoFactor,
  TwoFactorAuthenticatable,
  generateSecretKey,
  totp,
  verifyTotp,
  type TwoFactorAuthenticatableMethods,
} from "../src/index.ts";

// RFC 6238 appendix B: ASCII "12345678901234567890", SHA-1, last six digits.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

beforeAll(() => {
  Crypt.setKey(`base64:${Buffer.alloc(32, 7).toString("base64")}`);
});

@TwoFactorAuthenticatable()
class FakeUser {
  id = 1;
  email = "ada@example.com";
  two_factor_secret: string | null = null;
  two_factor_recovery_codes: string | null = null;
  two_factor_confirmed_at: Date | string | null = null;
  saves = 0;
  save() {
    this.saves += 1;
  }
}
interface FakeUser extends TwoFactorAuthenticatableMethods {}

test("totp matches the RFC 6238 test vectors", () => {
  expect(totp(RFC_SECRET, 59_000)).toBe("287082");
  expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe("081804");
  expect(totp(RFC_SECRET, 1_234_567_890_000)).toBe("005924");
  expect(totp(RFC_SECRET, 2_000_000_000_000)).toBe("279037");
});

test("verifyTotp allows one step of drift and rejects the rest", () => {
  const now = 1_111_111_109_000;
  expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), 1, now)).not.toBe(false);
  expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 30_000), 1, now)).not.toBe(false);
  expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 90_000), 1, now)).toBe(false);
  expect(verifyTotp(RFC_SECRET, "abc123", 1, now)).toBe(false);
});

test("generated secrets are 32 base32 characters", () => {
  expect(generateSecretKey()).toMatch(/^[A-Z2-7]{32}$/);
});

test("enable, confirm, reuse, recovery codes, and disable", async () => {
  const user = new FakeUser();
  await TwoFactor.enable(user);
  expect(user.two_factor_secret).not.toContain(user.twoFactorSecret());
  expect(user.hasEnabledTwoFactorAuthentication()).toBe(false);
  expect(user.recoveryCodes()).toHaveLength(8);
  expect(user.twoFactorQrCodeUrl()).toStartWith("otpauth://totp/");
  expect(user.twoFactorQrCodeSvg()).toStartWith("<svg");

  expect(await TwoFactor.confirm(user, "000000")).toBe(false);
  const code = totp(user.twoFactorSecret());
  expect(await TwoFactor.confirm(user, code)).toBe(true);
  expect(user.hasEnabledTwoFactorAuthentication()).toBe(true);
  // The same code can't sign in again.
  expect(await TwoFactor.verify(user, code)).toBe(false);

  const [first] = user.recoveryCodes();
  expect(await TwoFactor.useRecoveryCode(user, first!)).toBe(true);
  expect(user.recoveryCodes()).not.toContain(first);
  expect(user.recoveryCodes()).toHaveLength(8);
  expect(await TwoFactor.useRecoveryCode(user, first!)).toBe(false);

  await TwoFactor.disable(user);
  expect(user.hasEnabledTwoFactorAuthentication()).toBe(false);
  expect(user.recoveryCodes()).toEqual([]);
});
