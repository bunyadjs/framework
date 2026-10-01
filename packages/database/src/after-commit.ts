/**
 * After-commit hooks. Callbacks run after the outermost successful commit
 * and are discarded on rollback. Nested successful commits merge into the parent.
 */
import {
  transactionStore,
  type AfterCommitCallback,
} from "./transaction-context.ts";

const fallbackStack: AfterCommitCallback[][] = [];

function frames(): AfterCommitCallback[][] {
  return transactionStore()?.afterCommit ?? fallbackStack;
}

export function afterCommit(callback: AfterCommitCallback): void {
  const stack = frames();
  const frame = stack[stack.length - 1];
  if (frame) {
    frame.push(callback);
    return;
  }
  void Promise.resolve(callback());
}

export function pushAfterCommitFrame(): void {
  frames().push([]);
}

export async function flushAfterCommitFrame(commit: boolean): Promise<void> {
  const stack = frames();
  const frame = stack.pop() ?? [];
  if (!commit) return;
  const parent = stack[stack.length - 1];
  if (parent) {
    parent.push(...frame);
    return;
  }
  for (const cb of frame) {
    await cb();
  }
}

/** Test helper — depth of active after-commit frames. */
export function afterCommitFrameDepth(): number {
  return frames().length;
}
