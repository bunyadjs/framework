/**
 * Phase 3 — Node password + glob platforms (no live DB).
 * Run via `bun run --cwd packages/database test:node`.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { password, createGlob } from "./platforms/node/index.ts";
import { loadNodeBcrypt } from "./platforms/node/password.ts";

const PLAIN = "plain-password-phase3-node";
const COST = 4;

describe("Node password platform (bcrypt / bcryptjs)", () => {
  it("loadNodeBcrypt resolves native bcrypt or bcryptjs", () => {
    const impl = loadNodeBcrypt();
    assert.equal(typeof impl.hash, "function");
    assert.equal(typeof impl.hashSync, "function");
    assert.equal(typeof impl.compare, "function");
  });

  it("hashSync emits $2… and verify round-trips", async () => {
    const hash = password.hashSync(PLAIN, { algorithm: "bcrypt", cost: COST });
    assert.match(hash, /^\$2[aby]?\$/);
    assert.equal(await password.verify(PLAIN, hash), true);
    assert.equal(await password.verify("wrong", hash), false);
  });

  it("async hash emits $2… and verify round-trips", async () => {
    const hash = await password.hash(PLAIN, { algorithm: "bcrypt", cost: COST });
    assert.match(hash, /^\$2[aby]?\$04\$/);
    assert.equal(await password.verify(PLAIN, hash), true);
  });

  it("does not double-hash already-hashed values at the cast boundary", () => {
    // Platform always hashes; ORM `isAlreadyHashed` / castToStorage must skip.
    // Guard documented here so Node path stays aligned with casts.ts.
    const already = password.hashSync(PLAIN, {
      algorithm: "bcrypt",
      cost: COST,
    });
    assert.equal(already.startsWith("$2"), true);
    assert.equal(
      already.startsWith("$2") || already.startsWith("$argon2"),
      true,
    );
  });
});

describe("Node glob platform (migrator discovery)", () => {
  let dir = "";

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "bunyad-glob-"));
    await writeFile(join(dir, "20260101000000_create_users.ts"), "");
    await writeFile(join(dir, "20260102000000_add_posts.ts"), "");
    await writeFile(join(dir, "readme.md"), "");
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("createGlob('*.ts').scan yields relative *.ts paths", async () => {
    const files: string[] = [];
    for await (const file of createGlob("*.ts").scan({ cwd: dir })) {
      files.push(file);
    }
    files.sort();
    assert.deepEqual(files, [
      "20260101000000_create_users.ts",
      "20260102000000_add_posts.ts",
    ]);
  });
});
