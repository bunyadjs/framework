/**
 * A recovery code is a single-use value, so of several requests that present it together exactly one
 * may win, whichever copy of the user each request loaded. Run against real databases.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  TwoFactor,
  TwoFactorAuthenticatable,
  type TwoFactorAuthenticatableMethods,
} from "@bunyad/auth";
import { Crypt } from "@bunyad/common";
import {
  connectPostgres,
  connectSqlite,
  schemaFor,
  type Connection,
} from "@bunyad/database";
import { Model } from "@bunyad/orm";

/** SQLite always; Postgres too when BUNYAD_TEST_POSTGRES_URL points at a reachable server. */
async function testDrivers(): Promise<
  Array<{ name: string; connection: Connection }>
> {
  const drivers = [
    { name: "sqlite", connection: connectSqlite() as Connection },
  ];
  const url = Bun.env.BUNYAD_TEST_POSTGRES_URL;
  if (url && /^(postgres|postgresql):\/\//i.test(url)) {
    const connection = connectPostgres({ url, max: 2 });
    try {
      await connection.exec("SELECT 1");
      drivers.push({ name: "postgres", connection });
    } catch (error) {
      console.warn(
        `[two-factor-recovery-db] postgres unavailable: ${(error as Error).message}`,
      );
    }
  }
  return drivers;
}

const drivers = await testDrivers();

@TwoFactorAuthenticatable()
class TfUser extends Model {
  static table = "tf_users";
  static timestamps = false;
  static fillable = [
    "email",
    "two_factor_secret",
    "two_factor_recovery_codes",
    "two_factor_confirmed_at",
  ];
  declare id: number;
  declare email: string;
  declare two_factor_secret: string | null;
  declare two_factor_recovery_codes: string | null;
  declare two_factor_confirmed_at: string | null;
}
interface TfUser extends TwoFactorAuthenticatableMethods {}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "recovery codes (%s)",
  (_name, driver) => {
    const c = driver.connection;

    beforeAll(async () => {
      Crypt.setKey(`base64:${Buffer.alloc(32, 9).toString("base64")}`);
      Model.setConnection(c);
      const schema = schemaFor(c);
      await schema.dropIfExists("tf_users");
      await schema.create("tf_users", (b) => {
        b.id();
        b.string("email");
        b.text("two_factor_secret").nullable();
        b.text("two_factor_recovery_codes").nullable();
        b.string("two_factor_confirmed_at").nullable();
      });
    });

    afterAll(async () => {
      await schemaFor(c).dropIfExists("tf_users");
    });

    async function newUser(): Promise<{ id: number; codes: string[] }> {
      const user = await TfUser.create({
        email: `u${Math.random()}@example.com`,
      });
      await TwoFactor.enable(user);
      return { id: user.id, codes: user.recoveryCodes() };
    }

    test("of several requests with the same code, exactly one succeeds", async () => {
      const { id, codes } = await newUser();
      // each request loads its own copy of the user, as separate requests do
      const copies = await Promise.all(
        [1, 2, 3, 4, 5].map(() => TfUser.findOrFail(id)),
      );

      const results = await Promise.all(
        copies.map((copy) => TwoFactor.useRecoveryCode(copy, codes[0])),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      const stored = (await TfUser.findOrFail(id)).recoveryCodes();
      expect(stored).toHaveLength(8);
      expect(stored).not.toContain(codes[0]);
      expect(stored.slice(1)).toEqual(codes.slice(1));
    });

    test("a code that was used is refused afterwards", async () => {
      const { id, codes } = await newUser();
      expect(
        await TwoFactor.useRecoveryCode(await TfUser.findOrFail(id), codes[1]),
      ).toBe(true);
      expect(
        await TwoFactor.useRecoveryCode(await TfUser.findOrFail(id), codes[1]),
      ).toBe(false);
      // the other codes still work
      expect(
        await TwoFactor.useRecoveryCode(await TfUser.findOrFail(id), codes[2]),
      ).toBe(true);
    });

    test("using a code leaves the user's other columns alone", async () => {
      const { id, codes } = await newUser();
      const stale = await TfUser.findOrFail(id);
      await TfUser.where("id", id).update({ email: "changed@example.com" });

      expect(await TwoFactor.useRecoveryCode(stale, codes[3])).toBe(true);
      expect((await TfUser.findOrFail(id)).email).toBe("changed@example.com");
    });

    test("the in-memory copy shows the swapped codes after a successful use", async () => {
      const { id, codes } = await newUser();
      const user = await TfUser.findOrFail(id);
      expect(await TwoFactor.useRecoveryCode(user, codes[4])).toBe(true);
      expect(user.recoveryCodes()).not.toContain(codes[4]);
      expect(user.recoveryCodes()).toHaveLength(8);
    });
  },
);
