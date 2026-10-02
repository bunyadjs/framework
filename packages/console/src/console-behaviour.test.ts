import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { PassThrough } from "node:stream";
import { applyContext, startConsole, wrapEvalSource } from "./console.ts";

const g = globalThis as Record<string, unknown>;
const touched = new Set<string>();

afterEach(() => {
  for (const k of touched) delete g[k];
  touched.clear();
});

function ctx(values: Record<string, unknown>): Record<string, unknown> {
  for (const k of Object.keys(values)) touched.add(k);
  return values;
}

/** Run a scripted session; lines are written after the first prompt. */
async function session(
  lines: string[],
  options: Parameters<typeof startConsole>[0] = {},
  { end = false }: { end?: boolean } = {},
) {
  const input = new PassThrough();
  const output = new PassThrough();
  const printed: string[] = [];
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    const done = startConsole({
      input,
      output,
      print: (m) => printed.push(m),
      ...options,
    });
    await new Promise((r) => setTimeout(r, 10));
    for (const l of lines) input.write(`${l}\n`);
    if (end) input.end();
    await done;
    return { printed, errors: error.mock.calls.map((c) => c[0]), output };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("wrapEvalSource", () => {
  const run = (line: string) => (0, eval)(wrapEvalSource(line));

  test("returns the awaited value of an expression", async () => {
    expect(await run("1 + 2")).toBe(3);
    expect(await run("Promise.resolve('x')")).toBe("x");
  });

  test("object literals are evaluated as expressions, not blocks", async () => {
    expect(await run("{ a: 1 }")).toEqual({ a: 1 });
  });

  test("trims surrounding whitespace before deciding", () => {
    expect(wrapEvalSource("   42   ")).toContain("return await (42)");
  });

  test("keywords are statements only when a whole word starts the line", () => {
    expect(wrapEvalSource("constant + 1")).toContain("return await");
    expect(wrapEvalSource("letter")).toContain("return await");
    expect(wrapEvalSource("iffy")).toContain("return await");
    expect(wrapEvalSource("let a = 1")).not.toContain("return await");
    expect(wrapEvalSource("for (;;) {}")).not.toContain("return await");
  });

  test("a trailing semicolon forces statement mode", () => {
    expect(wrapEvalSource("1 + 1;")).not.toContain("return await");
  });

  test("throw statements propagate as rejections", async () => {
    await expect(run("throw new Error('nope')")).rejects.toThrow("nope");
  });

  test("a syntax error surfaces when evaluated, not when wrapping", () => {
    const src = wrapEvalSource("1 +");
    expect(() => (0, eval)(src)).toThrow(SyntaxError);
  });

  test("await expressions yield their value", async () => {
    expect(await run("await Promise.resolve(5)")).toBe(5);
  });
});

describe("applyContext", () => {
  test("overwrites existing globals and supports function values", () => {
    g.__ctxExisting = 1;
    const fn = () => "called";
    applyContext(ctx({ __ctxExisting: 2, __ctxFn: fn }));
    expect(g.__ctxExisting).toBe(2);
    expect((g.__ctxFn as () => string)()).toBe("called");
  });

  test("an empty context is a no-op", () => {
    const before = Object.keys(g).length;
    applyContext({});
    expect(Object.keys(g).length).toBe(before);
  });
});

describe("startConsole sessions", () => {
  test("prints the banner before anything else", async () => {
    const { printed } = await session([".exit"], { banner: "Welcome!" });
    expect(printed[0]).toBe("Welcome!");
    expect(printed.at(-1)).toBe("Bye.");
  });

  for (const word of [".exit", "exit", "quit"]) {
    test(`'${word}' ends the session`, async () => {
      const { printed } = await session([word]);
      expect(printed).toEqual(["Bye."]);
    });
  }

  test("Ctrl+D (end of input) closes the session", async () => {
    const { printed } = await session([], {}, { end: true });
    expect(printed).toEqual(["Bye."]);
  });

  test("lines after exit are not evaluated", async () => {
    await session([".exit", "globalThis.__afterExit = true"]);
    touched.add("__afterExit");
    expect(g.__afterExit).toBeUndefined();
  });

  test("blank and whitespace-only lines print nothing", async () => {
    const { printed } = await session(["", "   ", ".exit"]);
    expect(printed).toEqual(["Bye."]);
  });

  test("undefined results are not printed, falsy defined ones are", async () => {
    const { printed } = await session(["undefined", "0", "null", "false", ".exit"]);
    expect(printed).toEqual(["0", "null", "false", "Bye."]);
  });

  test("async expressions are awaited before printing", async () => {
    const { printed } = await session([
      "new Promise((r) => setTimeout(() => r('later'), 15))",
      ".exit",
    ]);
    expect(printed[0]).toContain("later");
  });

  test("results are inspected, including nested objects", async () => {
    const { printed } = await session(["({ a: { b: [1, 2] } })", ".exit"]);
    expect(printed[0]).toContain("a:");
    expect(printed[0]).toContain("[ 1, 2 ]");
  });

  test("an error is reported and the session keeps going", async () => {
    const { printed, errors } = await session([
      "throw new Error('kaboom')",
      "1 +",
      "40 + 2",
      ".exit",
    ]);
    expect(errors.length).toBe(2);
    expect(String(errors[0])).toContain("kaboom");
    expect(errors[1]).toBeInstanceOf(SyntaxError);
    expect(printed).toContain("42");
  });

  test("lines are processed strictly in order, even when async", async () => {
    const { printed } = await session([
      "new Promise((r) => setTimeout(() => r('slow'), 20))",
      "'fast'",
      ".exit",
    ]);
    const slow = printed.findIndex((p) => p.includes("slow"));
    const fast = printed.findIndex((p) => p.includes("fast"));
    expect(slow).toBeGreaterThanOrEqual(0);
    expect(slow).toBeLessThan(fast);
  });

  test("statements with declarations run without printing", async () => {
    const { printed } = await session([
      "globalThis.__stmt = 1;",
      "__stmt + 1",
      ".exit",
    ]);
    touched.add("__stmt");
    expect(printed).toEqual(["2", "Bye."]);
  });

  test("context is available as globals inside the session", async () => {
    const { printed } = await session(["user.name.toUpperCase()", ".exit"], {
      context: ctx({ user: { name: "ada" } }),
    });
    expect(printed[0]).toContain("ADA");
  });

  test("writes the prompt to the output stream", async () => {
    const { output } = await session([".exit"], { prompt: "bunyad> " });
    expect(output.read()?.toString() ?? "").toContain("bunyad> ");
  });
});
