/**
 * Password hashing facade.
 */
export type HashOptions = {
  algorithm?: "bcrypt" | "argon2id";
  /** Bcrypt cost (rounds). */
  cost?: number;
};

export type HashInfo = {
  algo: number;
  algoName: string;
  options: Record<string, unknown>;
};

/** `BCRYPT_ROUNDS` (default 10); tests lower it to 4 for speed. */
let defaultRounds = Number(process.env.BCRYPT_ROUNDS ?? 10);

/**
 * Explicit shape for `Hash` so its methods can reference `Hash`/`this`
 * from inside the object literal without a self-referential-initializer
 * inference cycle (TS7022).
 */
type HashFacade = {
  make(value: string, options?: HashOptions): Promise<string>;
  check(value: string, hashed: string): Promise<boolean>;
  needsRehash(hashed: string, options?: HashOptions): boolean;
  isHashed(value: string): boolean;
  info(hashed: string): HashInfo;
  setRounds(rounds: number): HashFacade;
  cost(): number;
  rounds(): number;
  verifyConfiguration(options?: HashOptions): boolean;
  isUsingCorrectAlgorithm(hashed: string, options?: HashOptions): boolean;
  isUsingValidOptions(hashed: string, options?: HashOptions): boolean;
};

export const Hash: HashFacade = {
  /** Hash a plain-text value. */
  async make(value: string, options: HashOptions = {}): Promise<string> {
    if (options.algorithm === "argon2id") {
      return Bun.password.hash(value, { algorithm: "argon2id" });
    }
    return Bun.password.hash(value, {
      algorithm: "bcrypt",
      cost: options.cost ?? defaultRounds,
    });
  },

  /** Verify plain text against a hash. */
  async check(value: string, hashed: string): Promise<boolean> {
    return Bun.password.verify(value, hashed);
  },

  /** Whether the hash should be rehashed. */
  needsRehash(hashed: string, options: HashOptions = {}): boolean {
    const algorithm = options.algorithm ?? "bcrypt";
    if (algorithm === "bcrypt") {
      if (!hashed.startsWith("$2")) return true;
      const cost = options.cost ?? defaultRounds;
      const match = /^\$2[aby]?\$(\d{2})\$/.exec(hashed);
      if (!match) return true;
      return Number(match[1]) !== cost;
    }
    return !hashed.startsWith("$argon2id$");
  },

  /** Whether a value looks like a hash. */
  isHashed(value: string): boolean {
    return (
      value.startsWith("$2") ||
      value.startsWith("$argon2id$") ||
      value.startsWith("$argon2i$") ||
      value.startsWith("$argon2d$")
    );
  },

  /** Hash info. */
  info(hashed: string): HashInfo {
    const bcrypt = /^\$2([aby]?)\$(\d{2})\$/.exec(hashed);
    if (bcrypt) {
      return {
        algo: 1,
        algoName: "bcrypt",
        options: { cost: Number(bcrypt[2]) },
      };
    }
    if (hashed.startsWith("$argon2id$")) {
      return { algo: 2, algoName: "argon2id", options: {} };
    }
    if (hashed.startsWith("$argon2i$")) {
      return { algo: 2, algoName: "argon2i", options: {} };
    }
    if (hashed.startsWith("$argon2d$")) {
      return { algo: 2, algoName: "argon2d", options: {} };
    }
    return { algo: 0, algoName: "unknown", options: {} };
  },

  /** Set bcrypt rounds. */
  setRounds(rounds: number): HashFacade {
    defaultRounds = rounds;
    return this;
  },

  /** Current bcrypt cost. */
  cost(): number {
    return defaultRounds;
  },

  /** Alias for `cost` (rounds). */
  rounds(): number {
    return defaultRounds;
  },

  /** Whether config looks usable. */
  verifyConfiguration(options: HashOptions = {}): boolean {
    const cost = options.cost ?? defaultRounds;
    return cost >= 4 && cost <= 31;
  },

  isUsingCorrectAlgorithm(hashed: string, options: HashOptions = {}): boolean {
    const algorithm = options.algorithm ?? "bcrypt";
    if (algorithm === "bcrypt") return hashed.startsWith("$2");
    return hashed.startsWith("$argon2id$");
  },

  isUsingValidOptions(hashed: string, options: HashOptions = {}): boolean {
    if (!this.isUsingCorrectAlgorithm(hashed, options)) return false;
    return !this.needsRehash(hashed, options);
  },
};

/** `bcrypt()` helper. */
export async function bcrypt(value: string, cost?: number): Promise<string> {
  return Hash.make(value, { algorithm: "bcrypt", cost });
}
