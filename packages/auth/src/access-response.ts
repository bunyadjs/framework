import { abort } from "@bunyad/http";

/**
 * Authorization result (Laravel `Illuminate\Auth\Access\Response`).
 */
export class AccessResponse {
  readonly #allowed: boolean;
  readonly #message: string | null;
  readonly #code: string | number | null;
  readonly #status: number | null;

  constructor(
    allowed: boolean,
    message: string | null = null,
    code: string | number | null = null,
    status: number | null = null,
  ) {
    this.#allowed = allowed;
    this.#message = message;
    this.#code = code;
    this.#status = status;
  }

  static allow(
    message: string | null = null,
    code: string | number | null = null,
  ): AccessResponse {
    return new AccessResponse(true, message, code);
  }

  static deny(
    message: string | null = null,
    code: string | number | null = null,
  ): AccessResponse {
    return new AccessResponse(false, message, code);
  }

  static denyWithStatus(
    status: number,
    message: string | null = null,
    code: string | number | null = null,
  ): AccessResponse {
    return new AccessResponse(false, message, code, status);
  }

  static denyAsNotFound(
    message: string | null = null,
    code: string | number | null = null,
  ): AccessResponse {
    return AccessResponse.denyWithStatus(404, message, code);
  }

  allowed(): boolean {
    return this.#allowed;
  }

  denied(): boolean {
    return !this.#allowed;
  }

  message(): string | null {
    return this.#message;
  }

  code(): string | number | null {
    return this.#code;
  }

  status(): number | null {
    return this.#status;
  }

  /** Throw when denied. */
  authorize(): this {
    if (this.denied()) {
      abort(this.#status ?? 403, this.#message ?? "This action is unauthorized.");
    }
    return this;
  }
}
