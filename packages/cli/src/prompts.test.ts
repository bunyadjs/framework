import { afterEach, expect, test } from "bun:test";
import {
  Prompt,
  alert,
  confirm,
  error,
  info,
  multiselect,
  number,
  password,
  restore,
  select,
  setPromptOutput,
  spin,
  table,
  text,
  warning,
} from "../src/index.ts";

afterEach(() => {
  restore();
  setPromptOutput((line) => console.log(line));
});

test("text / confirm / select / multiselect with Prompt.fake", async () => {
  const lines: string[] = [];
  setPromptOutput((line) => lines.push(line));
  Prompt.fake(["Ada", true, "owner", ["read", "write"]]);

  expect(
    await text({
      label: "Name?",
      required: true,
      validate: (v) => (v.length < 2 ? "Too short" : null),
    }),
  ).toBe("Ada");

  expect(await confirm("Continue?")).toBe(true);

  expect(
    await select({
      label: "Role?",
      options: {
        member: "Member",
        owner: "Owner",
      },
    }),
  ).toBe("owner");

  expect(
    await multiselect({
      label: "Perms?",
      options: ["read", "write", "delete"],
      required: true,
    }),
  ).toEqual(["read", "write"]);

  Prompt.assertAsked("text", "Name?");
  Prompt.assertAsked("confirm", "Continue?");
  Prompt.assertAsked("select", "Role?");
  Prompt.assertAsked("multiselect", "Perms?");
  expect(lines.some((l) => l.includes("Name?"))).toBe(true);
});

test("select accepts positional options list", async () => {
  Prompt.fake(["Jane"]);
  expect(await select("Name?", ["John", "Jane"])).toBe("Jane");
});

test("number validates min/max", async () => {
  Prompt.fake([2]);
  expect(await number({ label: "Copies?", min: 1, max: 5 })).toBe(2);
});

test("password returns fake answer", async () => {
  Prompt.fake(["secret"]);
  expect(await password("Password?")).toBe("secret");
});

test("info warning error alert and table", () => {
  const lines: string[] = [];
  setPromptOutput((line) => lines.push(line));
  info("hello");
  warning("careful");
  error("nope");
  alert("hey");
  table(["A", "B"], [[1, 2]]);
  expect(lines[0]).toContain("INFO");
  expect(lines[1]).toContain("WARN");
  expect(lines[2]).toContain("ERROR");
  expect(lines.some((l) => l.includes("A"))).toBe(true);
});

test("spin runs callback", async () => {
  Prompt.fake();
  const value = await spin("Working", async () => 42);
  expect(value).toBe(42);
  Prompt.assertAsked("spin", "Working");
});

test("required text fails when fake answer empty", async () => {
  Prompt.fake([""]);
  await expect(text({ label: "Name?", required: true })).rejects.toThrow(
    /Required/,
  );
});
