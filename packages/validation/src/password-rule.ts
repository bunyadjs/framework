import type { ValidationRule } from "./validator.ts";

export type CurrentPasswordVerifier = (
  plain: string,
  guard: string | undefined,
  user: { password?: string } | null | undefined,
) => boolean | Promise<boolean>;

let currentPasswordVerifier: CurrentPasswordVerifier | null = null;

/** Framework registers Auth+Hash check here (avoids validation→auth cycle). */
export function setCurrentPasswordVerifier(
  verifier: CurrentPasswordVerifier | null,
): void {
  currentPasswordVerifier = verifier;
}

export function getCurrentPasswordVerifier(): CurrentPasswordVerifier | null {
  return currentPasswordVerifier;
}

async function pwnedCount(password: string): Promise<number> {
  const digest = new Bun.CryptoHasher("sha1").update(password).digest("hex").toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { "Add-Padding": "true" },
  });
  if (!res.ok) return 0;
  const body = await res.text();
  for (const line of body.split("\n")) {
    const [hashSuffix, count] = line.trim().split(":");
    if (hashSuffix === suffix) return Number(count) || 0;
  }
  return 0;
}

/**
 * Laravel `Illuminate\Validation\Rules\Password`.
 *
 * Use `Password.defaults(() => Password.min(8).letters())` then `Rule.password()`.
 */
export class Password implements ValidationRule {
  static #defaultsFactory: (() => Password) | null = null;

  #minSize = 8;
  #requireLetters = false;
  #requireMixedCase = false;
  #requireNumbers = false;
  #requireSymbols = false;
  #uncompromised = false;
  #uncompromisedThreshold = 0;
  #customMessage: string | null = null;

  /** Laravel `Password::defaults`. */
  static defaults(callback: () => Password): void {
    Password.#defaultsFactory = callback;
  }

  /** Clear defaults (tests). */
  static clearDefaults(): void {
    Password.#defaultsFactory = null;
  }

  /** Laravel `Password::default()` — applied defaults or `min(8)`. */
  static default(): Password {
    return Password.#defaultsFactory
      ? Password.#defaultsFactory()
      : Password.min(8);
  }

  /** Laravel `Password::min($size)`. */
  static min(size: number): Password {
    return new Password().min(size);
  }

  min(size: number): this {
    this.#minSize = size;
    return this;
  }

  letters(): this {
    this.#requireLetters = true;
    return this;
  }

  mixedCase(): this {
    this.#requireMixedCase = true;
    return this;
  }

  numbers(): this {
    this.#requireNumbers = true;
    return this;
  }

  symbols(): this {
    this.#requireSymbols = true;
    return this;
  }

  /**
   * Laravel `uncompromised($threshold = 0)` — Have I Been Pwned range API.
   * Fails when the password appears more than `threshold` times in breaches.
   */
  uncompromised(threshold = 0): this {
    this.#uncompromised = true;
    this.#uncompromisedThreshold = threshold;
    return this;
  }

  withMessage(message: string): this {
    this.#customMessage = message;
    return this;
  }

  async passes(
    _attribute: string,
    value: unknown,
    _data: Record<string, unknown>,
    _context?: { user?: unknown },
  ): Promise<boolean> {
    if (value == null || value === "") return true;
    if (typeof value !== "string") return false;

    if (value.length < this.#minSize) return false;
    if (this.#requireLetters && !/[a-zA-Z]/.test(value)) return false;
    if (
      this.#requireMixedCase &&
      !( /[a-z]/.test(value) && /[A-Z]/.test(value))
    ) {
      return false;
    }
    if (this.#requireNumbers && !/\d/.test(value)) return false;
    if (this.#requireSymbols && !/[^a-zA-Z0-9]/.test(value)) return false;

    if (this.#uncompromised) {
      try {
        const count = await pwnedCount(value);
        if (count > this.#uncompromisedThreshold) return false;
      } catch {
        // Network failure — do not fail closed on HIBP outage.
      }
    }
    return true;
  }

  message(): string {
    return (
      this.#customMessage ??
      "The :attribute field must meet the password requirements."
    );
  }
}
