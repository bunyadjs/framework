/**
 * Nested transactions: BEGIN / COMMIT / ROLLBACK at level 1,
 * SAVEPOINT / RELEASE / ROLLBACK TO at deeper levels.
 * Depth is per async context so concurrent requests do not share savepoints.
 */
import {
  flushAfterCommitFrame,
  pushAfterCommitFrame,
} from "./after-commit.ts";
import {
  setTxDepth,
  txDepth,
  withTransactionStore,
} from "./transaction-context.ts";

export type NestedTransactionExec = {
  begin(): void | Promise<void>;
  commit(): void | Promise<void>;
  rollback(): void | Promise<void>;
  savepoint(name: string): void | Promise<void>;
  releaseSavepoint(name: string): void | Promise<void>;
  rollbackToSavepoint(name: string): void | Promise<void>;
};

export function savepointName(level: number): string {
  return `bunyad_sp_${level}`;
}

/** Detect deadlock / serialization failures worth retrying. */
export function isRetryableTransactionError(error: unknown): boolean {
  const message = String(
    error instanceof Error ? error.message : error ?? "",
  ).toLowerCase();
  if (
    message.includes("deadlock") ||
    message.includes("serialization failure") ||
    message.includes("could not serialize") ||
    message.includes("lock wait timeout") ||
    message.includes("database is locked")
  ) {
    return true;
  }
  const code =
    error && typeof error === "object"
      ? String(
          (error as { code?: unknown; errno?: unknown }).code ??
            (error as { errno?: unknown }).errno ??
            "",
        )
      : "";
  return (
    code === "40P01" ||
    code === "40001" ||
    code === "1213" ||
    code === "1205" ||
    code === "SQLITE_BUSY"
  );
}

/**
 * Per-connection nesting for `transaction()` and manual begin/commit/rollBack.
 */
export function createTransactionApi(
  exec: NestedTransactionExec,
  key: object = {},
) {
  async function beginTransaction(): Promise<void> {
    const depth = txDepth(key) + 1;
    setTxDepth(key, depth);
    pushAfterCommitFrame();
    try {
      if (depth === 1) await exec.begin();
      else await exec.savepoint(savepointName(depth));
    } catch (error) {
      setTxDepth(key, depth - 1);
      await flushAfterCommitFrame(false);
      throw error;
    }
  }

  async function commit(): Promise<void> {
    const depth = txDepth(key);
    if (depth <= 0) {
      throw new Error("There is no active transaction.");
    }
    if (depth === 1) await exec.commit();
    else await exec.releaseSavepoint(savepointName(depth));
    setTxDepth(key, depth - 1);
    await flushAfterCommitFrame(true);
  }

  async function rollBack(): Promise<void> {
    const depth = txDepth(key);
    if (depth <= 0) {
      throw new Error("There is no active transaction.");
    }
    try {
      if (depth === 1) await exec.rollback();
      else await exec.rollbackToSavepoint(savepointName(depth));
    } finally {
      setTxDepth(key, depth - 1);
      await flushAfterCommitFrame(false);
    }
  }

  async function transactionOnce<T>(
    callback: () => T | Promise<T>,
  ): Promise<T> {
    return withTransactionStore(key, async () => {
      await beginTransaction();
      try {
        const result = await callback();
        await commit();
        return result;
      } catch (error) {
        await rollBack();
        throw error;
      }
    });
  }

  /**
   * Run `callback` in a transaction.
   * Optional `attempts` retries the whole transaction on deadlock-like errors.
   */
  async function transaction<T>(
    callback: () => T | Promise<T>,
    attempts = 1,
  ): Promise<T> {
    const max = Math.max(1, Math.trunc(attempts));
    let lastError: unknown;
    for (let i = 0; i < max; i++) {
      try {
        return await transactionOnce(callback);
      } catch (error) {
        lastError = error;
        if (i === max - 1 || !isRetryableTransactionError(error)) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  return {
    key,
    beginTransaction,
    commit,
    rollBack,
    transaction,
    get depth() {
      return txDepth(key);
    },
  };
}
