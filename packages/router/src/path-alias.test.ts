import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Bun resolves @/ via tsconfig paths to app/*", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bunyad-alias-")));
  await mkdir(join(root, "app", "Models"), { recursive: true });
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["app/*"] },
      },
    }),
  );
  await writeFile(
    join(root, "app", "Models", "User.ts"),
    `export default class User { static table = "users"; }\n`,
  );

  const resolved = Bun.resolveSync("@/Models/User.ts", root);
  expect(resolved).toBe(join(root, "app", "Models", "User.ts"));

  await rm(root, { recursive: true, force: true });
});
