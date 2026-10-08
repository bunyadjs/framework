/** Absolute path of a file shipped in the package's `stubs/` folder (published into the app by `bunyad publish`). */
export function stubPath(name: string): string {
  return decodeURIComponent(new URL(`../stubs/${name}`, import.meta.url).pathname);
}

export const PUBLISH_TAGS = { migrations: "permissions-migrations", config: "permissions-config" } as const;
