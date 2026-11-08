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
  test(`${name}: a reset link works once`, async () => {
    const user = { id: 1, email: "ada@example.com", password: "old" };
    let link = "";
    const broker = new PasswordBroker({
      retrieveByCredentials: (email) => (email === user.email ? user : null),
      sendResetNotification: (_user, token) => {
        link = token;
      },
      tokens: makeStore(),
      throttle: 0,
    });
    await broker.sendResetLink({ email: user.email });

    expect(
      await broker.reset(
        { email: user.email, token: "wrong", password: "new" },
        async () => {},
      ),
    ).toBe("passwords.token");
    expect(
      await broker.reset(
        { email: user.email, token: link, password: "new" },
        async () => {},
      ),
    ).toBe("passwords.reset");
    expect(
      await broker.reset(
        { email: user.email, token: link, password: "again" },
        async () => {},
      ),
    ).toBe("passwords.token");
  });
}

test("database store: the token is stored as a hash", async () => {
  const { connection, sqlite } = database();
  const tokens = new DatabasePasswordTokenRepository({
    connection,
    throttle: 0,
  });
  const plain = await tokens.create("ada@example.com");
  const row = sqlite.query("SELECT token FROM password_reset_tokens").get() as {
    token: string;
  };
  expect(row.token).not.toBe(plain);
  expect(row.token).toHaveLength(64);
});

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
