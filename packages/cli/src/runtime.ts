/** Oldest Bun the framework is tested on (see docs/STABILITY.md). */
export const MIN_BUN_VERSION = "1.4.0";

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).slice(0, 3).map(Number);
  const pb = b.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** A message when this runtime cannot run Bunyad, or null when it can. */
export function unsupportedRuntimeMessage(
  bunVersion: string | undefined = (globalThis as { Bun?: { version: string } }).Bun?.version,
): string | null {
  if (!bunVersion) {
    return "Bunyad needs Bun, and this is not running on Bun. Install it from https://bun.sh, then run `bun create bunyad my-app`.";
  }
  if (compareVersions(bunVersion, MIN_BUN_VERSION) < 0) {
    return `Bunyad needs Bun ${MIN_BUN_VERSION} or newer, but this is Bun ${bunVersion}. Upgrade with \`bun upgrade\`.`;
  }
  return null;
}

/** Why an app directory name cannot be used, or null when it is fine. */
export function appNameProblem(dir: string): string | null {
  const name = dir.split(/[/\\]/).filter(Boolean).pop() ?? "";
  if (!name) return "Please provide a directory name.";
  if (/\s/.test(name)) return `"${name}" contains spaces. Use letters, numbers, dashes and underscores, e.g. "${name.trim().replace(/\s+/g, "-").toLowerCase()}".`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    return `"${name}" is not a valid app name. Start with a letter or number and use only letters, numbers, dots, dashes and underscores.`;
  }
  return null;
}
