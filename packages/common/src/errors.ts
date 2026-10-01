/**
 * Framework error base — lean, no stack munging.
 */
export class BunyadError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "BunyadError";
  }
}
