/**
 * Phase 0 spike: prove Bun.password bcrypt ($2…) is interoperable with
 * Node `bcrypt` (native) and `bcryptjs` (pure JS fallback).
 *
 * Algorithm: bcrypt, cost from BCRYPT_ROUNDS (default 10; this suite uses 4).
 * Prefix: $2… (Bun emits $2b$; Node libs accept/verify $2a$/$2b$).
 * No double-hash: isAlreadyHashed / $2 prefix guard stays in ORM casts.
 */
import { describe, expect, test } from "bun:test";
import bcrypt from "bcrypt";
import bcryptjs from "bcryptjs";

const PLAIN = "plain-password-spike-phase0";
/** Match ORM/auth test speed; production default remains 10 via BCRYPT_ROUNDS. */
const COST = 4;

describe("Phase 0 bcrypt parity (Bun.password ↔ Node)", () => {
  test("Bun.password.hash bcrypt cost=4 emits $2 and verifies with Bun", async () => {
    const hash = await Bun.password.hash(PLAIN, {
      algorithm: "bcrypt",
      cost: COST,
    });
    expect(hash.startsWith("$2")).toBe(true);
    expect(/^\$2[aby]?\$04\$/.test(hash)).toBe(true);
    expect(await Bun.password.verify(PLAIN, hash)).toBe(true);
    expect(await Bun.password.verify("wrong", hash)).toBe(false);
  });

  test("Bun hash verifies with native bcrypt and bcryptjs", async () => {
    const bunHash = await Bun.password.hash(PLAIN, {
      algorithm: "bcrypt",
      cost: COST,
    });
    expect(await bcrypt.compare(PLAIN, bunHash)).toBe(true);
    expect(await bcrypt.compare("wrong", bunHash)).toBe(false);
    expect(await bcryptjs.compare(PLAIN, bunHash)).toBe(true);
    expect(await bcryptjs.compare("wrong", bunHash)).toBe(false);
  });

  test("native bcrypt hash verifies with Bun.password and bcryptjs", async () => {
    const nativeHash = await bcrypt.hash(PLAIN, COST);
    expect(nativeHash.startsWith("$2")).toBe(true);
    expect(await Bun.password.verify(PLAIN, nativeHash)).toBe(true);
    expect(await bcryptjs.compare(PLAIN, nativeHash)).toBe(true);
  });

  test("bcryptjs hash verifies with Bun.password and native bcrypt", async () => {
    const jsHash = await bcryptjs.hash(PLAIN, COST);
    expect(jsHash.startsWith("$2")).toBe(true);
    expect(await Bun.password.verify(PLAIN, jsHash)).toBe(true);
    expect(await bcrypt.compare(PLAIN, jsHash)).toBe(true);
  });

  test("sync Bun.password.hashSync matches Node verify (ORM castToStorage path)", async () => {
    const syncHash = Bun.password.hashSync(PLAIN, {
      algorithm: "bcrypt",
      cost: COST,
    });
    expect(syncHash.startsWith("$2")).toBe(true);
    expect(await bcrypt.compare(PLAIN, syncHash)).toBe(true);
    expect(await bcryptjs.compare(PLAIN, syncHash)).toBe(true);
  });

  test("default production cost 10 still interoperable (one round-trip)", async () => {
    const bunHash = await Bun.password.hash(PLAIN, {
      algorithm: "bcrypt",
      cost: 10,
    });
    expect(/^\$2[aby]?\$10\$/.test(bunHash)).toBe(true);
    expect(await bcrypt.compare(PLAIN, bunHash)).toBe(true);
    expect(await bcryptjs.compare(PLAIN, bunHash)).toBe(true);
  });
});
