/** Thrown by `dd()` in HTTP requests (and when `useDdThrow()` is on). */
export class DdException extends Error {
  readonly values: unknown[];

  constructor(values: unknown[]) {
    super("dd()");
    this.name = "DdException";
    this.values = values;
  }
}
