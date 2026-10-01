import type { EventEmitter } from "node:events";
import * as readline from "node:readline";
import { inspect } from "node:util";
import type { Readable, Writable } from "node:stream";

export type ConsoleOptions = {
  prompt?: string;
  banner?: string;
  context?: Record<string, unknown>;
  input?: Readable;
  output?: Writable;
  print?: (message: string) => void;
};

/** Wrap a line so both expressions and statements can `await`. */
export function wrapEvalSource(line: string): string {
  const code = line.trim();
  const isStatement =
    /^\s*(const|let|var|await|for|if|while|import|return|throw|try|class|function|delete|export)\b/.test(
      code,
    ) || code.endsWith(";");
  if (isStatement) {
    return `(async () => { ${code} })()`;
  }
  return `(async () => { return await (${code}); })()`;
}

export function applyContext(context: Record<string, unknown>): void {
  const g = globalThis as Record<string, unknown>;
  for (const [key, value] of Object.entries(context)) {
    g[key] = value;
  }
}

/** Interactive shell. Exit with `.exit`, `exit`, `quit`, or Ctrl+D. */
export async function startConsole(options: ConsoleOptions = {}): Promise<void> {
  const print = options.print ?? ((message: string) => console.log(message));
  if (options.context) {
    applyContext(options.context);
  }
  if (options.banner) {
    print(options.banner);
  }

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const prompt = options.prompt ?? "> ";

  process.on("unhandledRejection", (err) => {
    console.error(err);
  });

  const rl = readline.createInterface({
    input,
    output,
    terminal: Boolean(
      (input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY,
    ),
    prompt,
  }) as unknown as readline.Interface & EventEmitter;

  console.log("");
  rl.prompt();

  let processing = Promise.resolve();

  rl.on("line", (line: string) => {
    processing = processing.then(async () => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }
      if (trimmed === ".exit" || trimmed === "exit" || trimmed === "quit") {
        rl.close();
        return;
      }

      try {
        const result = await (0, eval)(wrapEvalSource(trimmed));
        if (result !== undefined) {
          print(inspect(result, { depth: 6, colors: Boolean(process.stdout.isTTY) }));
        }
      } catch (err) {
        console.error(err);
      }
      rl.prompt();
    });
  });

  await new Promise<void>((resolve) => {
    rl.on("close", () => {
      print("Bye.");
      resolve();
    });
  });
}
