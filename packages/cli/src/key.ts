import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Crypt } from "@bunyad/common";

/**
 * Put `APP_KEY=<key>` into `.env`, creating the file from `.env.example` when it is missing.
 * Returns the key. An existing key is kept unless `force` is set.
 */
export async function writeAppKey(
  root: string,
  options: { force?: boolean } = {},
): Promise<{ key: string; written: boolean }> {
  const envPath = resolve(root, ".env");
  const examplePath = resolve(root, ".env.example");
  let contents = existsSync(envPath)
    ? await Bun.file(envPath).text()
    : existsSync(examplePath)
      ? await Bun.file(examplePath).text()
      : "";

  const current = /^APP_KEY=(.*)$/m.exec(contents)?.[1]?.trim();
  if (current && !options.force) return { key: current, written: false };

  const key = Crypt.generateKey();
  contents = /^APP_KEY=.*$/m.test(contents)
    ? contents.replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`)
    : `${contents}${contents === "" || contents.endsWith("\n") ? "" : "\n"}APP_KEY=${key}\n`;
  await Bun.write(envPath, contents);
  return { key, written: true };
}
