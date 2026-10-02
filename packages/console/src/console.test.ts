import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { applyContext, startConsole, wrapEvalSource } from "./console.ts";

test("wrapEvalSource treats expressions as awaited values", () => {
  expect(wrapEvalSource("1 + 1")).toContain("return await (1 + 1)");
  expect(wrapEvalSource("const x = 1")).toContain("{ const x = 1 }");
  expect(wrapEvalSource("await Contact.find(1)")).toContain("return await (await Contact.find(1))");
});

test("applyContext writes keys onto globalThis", () => {
  applyContext({ __bunyadConsoleFlag: 42 });
  expect((globalThis as { __bunyadConsoleFlag?: number }).__bunyadConsoleFlag).toBe(
    42,
  );
  delete (globalThis as { __bunyadConsoleFlag?: number }).__bunyadConsoleFlag;
});

test("startConsole evaluates a line then exits", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const printed: string[] = [];
  const done = startConsole({
    input,
    output,
    prompt: "> ",
    context: { answer: 41 },
    print: (message) => printed.push(message),
  });

  await new Promise((r) => setTimeout(r, 20));
  input.write("answer + 1\n");
  input.write(".exit\n");
  await done;

  expect(printed.some((line) => line.includes("42"))).toBe(true);
});
