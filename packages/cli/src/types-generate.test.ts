import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateTypes, routesModule } from "./types-generate.ts";

const scratch = mkdtempSync(join(tmpdir(), "bunyad-types-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("route() fills parameters, drops unfilled optional segments, and puts the rest in the query", async () => {
  const file = join(scratch, "routes.ts");
  writeFileSync(file, routesModule({
    home: "/",
    "password.reset": "/reset-password/{token}",
    "posts.show": "/users/{user}/posts/{post?}",
  }));
  const { route } = await import(file);

  expect(route("home")).toBe("/");
  expect(route("password.reset", { token: "a b", email: "ada@example.com" })).toBe("/reset-password/a%20b?email=ada%40example.com");
  expect(route("posts.show", { user: 1, post: 2 })).toBe("/users/1/posts/2");
  expect(route("posts.show", { user: 1 })).toBe("/users/1/posts");
  expect(route("home", { page: 2, empty: null })).toBe("/?page=2");
});

test("types come from the React kit: page props, shared props, and the route list", async () => {
  const root = resolve(import.meta.dir, "../../../templates/react");
  const files = Object.fromEntries(
    (await generateTypes(root, { dashboard: "/dashboard" })).map((file) => [file.path, file.contents]),
  );

  expect(files["resources/js/routes.ts"]).toContain('"dashboard": "/dashboard",');
  // Each page's props, from the component's parameter.
  expect(files["types/inertia.d.ts"]).toContain('"settings/profile": { mustVerifyEmail: boolean };');
  expect(files["types/inertia.d.ts"]).toContain('"auth/reset-password": { token: string; email?: string | undefined };');
  // What HandleInertiaRequests.share() returns, with the validation errors.
  expect(files["resources/js/types/shared.d.ts"]).toContain("export type SharedData = { name: string; auth: { user: {");
  expect(files["resources/js/types/shared.d.ts"]).toContain("& { errors: Record<string, string> };");
}, 30_000);
