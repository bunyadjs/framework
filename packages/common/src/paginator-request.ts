import { AsyncLocalStorage } from "node:async_hooks";

/** Duck-typed request used to build paginator `path` / query-string links. */
export type PaginatorRequestLike = {
  urlWithoutQuery(): string;
  query(): Record<string, string>;
  input(key: string, defaultValue?: unknown): unknown;
};

const storage = new AsyncLocalStorage<PaginatorRequestLike>();

/** Bind the current request for paginator URL generation. */
export function runWithPaginatorRequest<T>(
  request: PaginatorRequestLike,
  fn: () => T,
): T {
  return storage.run(request, fn);
}

export function getPaginatorRequest(): PaginatorRequestLike | undefined {
  return storage.getStore();
}
