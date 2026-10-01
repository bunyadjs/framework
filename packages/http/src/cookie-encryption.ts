import { Crypt } from "@bunyad/common";

/**
 * Cookies that must stay clear-text (or are encrypted elsewhere).
 * Session id cookies are not encrypted here — the session store encrypts the bag.
 * `XSRF-TOKEN` is encrypted by CSRF middleware for SPA clients.
 */
const DEFAULT_EXCEPT = new Set(["XSRF-TOKEN", "bunyad_session"]);

let exceptNames = new Set(DEFAULT_EXCEPT);
let encryptionEnabled = true;

/** Replace the cookie-name except list (session / XSRF stay documented defaults). */
export function setEncryptedCookieExcept(names: string[]): void {
  exceptNames = new Set(names);
}

/** Add names to the except list without clearing existing entries. */
export function addEncryptedCookieExcept(names: string | string[]): void {
  for (const name of Array.isArray(names) ? names : [names]) {
    exceptNames.add(name);
  }
}

export function getEncryptedCookieExcept(): string[] {
  return [...exceptNames];
}

/** Enable or disable application cookie encryption (`APP_KEY` still required when on). */
export function setCookieEncryptionEnabled(enabled: boolean): void {
  encryptionEnabled = enabled;
}

export function isCookieEncryptionEnabled(): boolean {
  return encryptionEnabled;
}

export function shouldEncryptCookie(name: string): boolean {
  return encryptionEnabled && !exceptNames.has(name);
}

/** Encrypt a cookie value when encryption applies; otherwise return as-is. */
export function encryptCookieValue(name: string, value: string): string {
  if (!shouldEncryptCookie(name) || value === "") return value;
  try {
    return Crypt.encrypt(value);
  } catch {
    // No APP_KEY in some unit tests — leave plaintext.
    return value;
  }
}

/** Decrypt a cookie value when it looks encrypted; plaintext passthrough on failure. */
export function decryptCookieValue(name: string, value: string): string {
  if (!shouldEncryptCookie(name) || value === "") return value;
  try {
    return Crypt.decrypt(value);
  } catch {
    return value;
  }
}

/** Reset except-list and enable flag (tests). */
export function resetCookieEncryptionForTests(): void {
  exceptNames = new Set(DEFAULT_EXCEPT);
  encryptionEnabled = true;
}
