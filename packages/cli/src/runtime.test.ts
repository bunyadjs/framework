import { expect, test } from "bun:test";
import { appNameProblem, MIN_BUN_VERSION, unsupportedRuntimeMessage } from "./runtime.ts";

test("a supported Bun passes", () => {
  expect(unsupportedRuntimeMessage(MIN_BUN_VERSION)).toBeNull();
  expect(unsupportedRuntimeMessage("1.9.2")).toBeNull();
  expect(unsupportedRuntimeMessage("2.0.0")).toBeNull();
});

test("an old Bun says which version is needed and how to upgrade", () => {
  const message = unsupportedRuntimeMessage("1.3.9")!;
  expect(message).toContain(MIN_BUN_VERSION);
  expect(message).toContain("1.3.9");
  expect(message).toContain("bun upgrade");
});

test("no Bun at all points to the installer", () => {
  // Called with an explicit empty version the way Node (no `Bun` global) would.
  const message = unsupportedRuntimeMessage("")!;
  expect(message).toContain("https://bun.sh");
});

test("app names: good ones pass, spaces and odd characters are explained", () => {
  for (const ok of ["my-app", "my_app", "app2", "a.b", "apps/shop-api", "../sibling"]) {
    expect(appNameProblem(ok)).toBeNull();
  }
  expect(appNameProblem("")).toContain("directory name");
  expect(appNameProblem("my app")).toContain("spaces");
  expect(appNameProblem("My App")).toContain('"my-app"');
  expect(appNameProblem("-leading")).toContain("not a valid app name");
  expect(appNameProblem("bad$name")).toContain("not a valid app name");
});
