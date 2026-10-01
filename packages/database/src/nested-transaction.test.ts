import { expect, test } from "bun:test";
import {
  createTransactionApi,
  savepointName,
} from "./nested-transaction.ts";

function mockExec(log: string[]) {
  return {
    begin: async () => {
      log.push("BEGIN");
    },
    commit: async () => {
      log.push("COMMIT");
    },
    rollback: async () => {
      log.push("ROLLBACK");
    },
    savepoint: async (name: string) => {
      log.push(`SAVEPOINT ${name}`);
    },
    releaseSavepoint: async (name: string) => {
      log.push(`RELEASE ${name}`);
    },
    rollbackToSavepoint: async (name: string) => {
      log.push(`ROLLBACK TO ${name}`);
    },
  };
}

test("concurrent transactions each BEGIN instead of sharing a savepoint", async () => {
  const log: string[] = [];
  const api = createTransactionApi(mockExec(log));
  const started = Promise.withResolvers<void>();
  let waiting = 0;

  await Promise.all([
    api.transaction(async () => {
      waiting += 1;
      if (waiting === 2) started.resolve();
      await started.promise;
    }),
    api.transaction(async () => {
      waiting += 1;
      if (waiting === 2) started.resolve();
      await started.promise;
    }),
  ]);

  expect(log.filter((item) => item === "BEGIN")).toHaveLength(2);
  expect(log.filter((item) => item === "COMMIT")).toHaveLength(2);
  expect(log.some((item) => item.startsWith("SAVEPOINT"))).toBe(false);
});

test("nested transaction uses a savepoint on the same async stack", async () => {
  const log: string[] = [];
  const api = createTransactionApi(mockExec(log));

  await api.transaction(async () => {
    await api.transaction(async () => {});
  });

  expect(log).toEqual([
    "BEGIN",
    `SAVEPOINT ${savepointName(2)}`,
    `RELEASE ${savepointName(2)}`,
    "COMMIT",
  ]);
});

test("failed begin does not leak depth into the next transaction", async () => {
  let begins = 0;
  const api = createTransactionApi({
    begin: async () => {
      begins += 1;
      if (begins === 1) throw new Error("begin-fail");
    },
    commit: async () => {},
    rollback: async () => {},
    savepoint: async () => {
      throw new Error("should not savepoint");
    },
    releaseSavepoint: async () => {},
    rollbackToSavepoint: async () => {},
  });

  await expect(api.transaction(async () => "ok")).rejects.toThrow("begin-fail");
  await expect(api.transaction(async () => "ok")).resolves.toBe("ok");
});
