import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  DatabasePasswordTokenRepository,
  MemoryPasswordTokenRepository,
  PasswordBroker,
  type PasswordTokenConnection,
  type PasswordTokenRepository,
} from "./password.ts";

function database() {
  const sqlite = new Database(":memory:");
  sqlite.run(
    "CREATE TABLE password_reset_tokens (email TEXT PRIMARY KEY, token TEXT NOT NULL, created_at INTEGER NOT NULL)",
  );
  return {
    sqlite,
    connection: {
      run: (sql: string, params: unknown[] = []) =>
        sqlite.run(sql, params as never[]),
      get: ((sql: string, params: unknown[] = []) =>
        sqlite.query(sql).get(...(params as never[])) ??
        null) as PasswordTokenConnection["get"],
    },
  };
}

const stores: Array<[string, () => PasswordTokenRepository]> = [
  ["in-memory store", () => new MemoryPasswordTokenRepository(60, 0)],
  [
    "database store",
    () =>
      new DatabasePasswordTokenRepository({
        connection: database().connection,
        throttle: 0,
      }),
  ],
];

for (const [name, makeStore] of stores) {
  test(`${name}: a reset link works once, even when two requests arrive together`, async () => {
    const tokens = makeStore();
    const user = { id: 1, email: "ada@example.com", password: "old" };
    let link = "";
    const broker = new PasswordBroker({
      retrieveByCredentials: (email) => (email === user.email ? user : null),
      sendResetNotification: (_user, token) => {
        link = token;
      },
      tokens,
      throttle: 0,
    });
    await broker.sendResetLink({ email: user.email });

    let applied = 0;
    const attempt = () =>
      broker.reset(
        { email: user.email, token: link, password: "new" },
        async () => {
          // a slow write: the other request arrives while this one is still applying the password
          await new Promise((resolve) => setTimeout(resolve, 20));
          applied += 1;
        },
      );
    const results = await Promise.all([attempt(), attempt(), attempt()]);

    expect(applied).toBe(1);
    expect(
      results.filter((status) => status === "passwords.reset"),
    ).toHaveLength(1);
    expect(
      results.filter((status) => status === "passwords.token"),
    ).toHaveLength(2);
    // and the link stays dead afterwards
    expect(
      await broker.reset(
        { email: user.email, token: link, password: "again" },
        async () => {},
      ),
    ).toBe("passwords.token");
  });
}

test("database store: an expired token is refused and removed", async () => {
  const { connection, sqlite } = database();
  const tokens = new DatabasePasswordTokenRepository({
    connection,
    expire: 1,
    throttle: 0,
  });
  const plain = await tokens.create("ada@example.com");
  sqlite.run("UPDATE password_reset_tokens SET created_at = created_at - 7200");

  expect(await tokens.exists("ada@example.com", plain)).toBe(false);
  expect(
    sqlite.query("SELECT COUNT(*) AS n FROM password_reset_tokens").get(),
  ).toEqual({ n: 0 });
});

test("database store: a wrong token does not use up the real one", async () => {
  const { connection } = database();
  const tokens = new DatabasePasswordTokenRepository({
    connection,
    throttle: 0,
  });
  const plain = await tokens.create("ada@example.com");

  expect(await tokens.consume!("ada@example.com", "wrong")).toBe(false);
  expect(await tokens.exists("ada@example.com", plain)).toBe(true);
  expect(await tokens.consume!("ada@example.com", plain)).toBe(true);
  expect(await tokens.consume!("ada@example.com", plain)).toBe(false);
});
