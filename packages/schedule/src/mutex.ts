import { mkdir, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Atomic-ish file mutex with expiry (`withoutOverlapping`-lite).
 * Returns true if the lock was acquired.
 */
export async function acquireMutex(
  path: string,
  expiresMs: number,
): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });

  try {
    const until = Number(await Bun.file(path).text());
    if (Number.isFinite(until) && until > Date.now()) {
      return false;
    }
    await unlink(path).catch(() => {});
  } catch {
    // missing lock file
  }

  try {
    const handle = await open(path, "wx");
    await handle.writeFile(String(Date.now() + expiresMs));
    await handle.close();
    return true;
  } catch {
    return false;
  }
}

export async function releaseMutex(path: string): Promise<void> {
  await unlink(path).catch(() => {});
}

/** Stable filename fragment from an event key. */
export function mutexFilename(key: string): string {
  const hash = Bun.hash(key).toString(16);
  return `${hash}.lock`;
}
