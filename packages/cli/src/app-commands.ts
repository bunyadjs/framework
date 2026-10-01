import { resolve } from "node:path";
import { Glob } from "bun";
import {
  Command,
  commandDescription,
  commandName,
} from "./command.ts";

type CommandClass = typeof Command & {
  signature?: string;
  description?: string;
};

export type CommandHandler = (args: string[]) => Promise<void>;

export async function loadAppCommandHandlers(
  cwd = process.cwd(),
): Promise<Record<string, CommandHandler>> {
  const handlers: Record<string, CommandHandler> = {};
  const glob = new Glob("app/Console/Commands/**/*.{ts,js}");
  for await (const file of glob.scan({ cwd })) {
    if (/\.(spec|test)\./.test(file)) {
      continue;
    }
    const mod = (await import(resolve(cwd, file))) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (!isCommandClass(value)) {
        continue;
      }
      const name = commandName(value);
      if (!name) {
        continue;
      }
      handlers[name] = async (args: string[]) => {
        const command = new (value as new () => Command)();
        command.bindInput(args);
        if (!(await command.ensureRequiredArguments())) {
          process.exitCode = 1;
          return;
        }
        const code = await command.handle();
        if (typeof code === "number") {
          process.exitCode = code;
        }
      };
    }
  }
  return handlers;
}

export async function runAppCommands(
  argv: string[],
  cwd = process.cwd(),
): Promise<number> {
  const handlers = await loadAppCommandHandlers(cwd);
  const name = argv[0] ?? "list";
  if (name === "list" || name === "--help" || name === "-h") {
    printAppCommandList(handlers, cwd);
    return 0;
  }
  const handler = handlers[name];
  if (!handler) {
    console.error(`Command "${name}" is not defined.`);
    printAppCommandList(handlers, cwd);
    return 1;
  }
  await handler(argv.slice(1));
  return Number(process.exitCode ?? 0);
}

function isCommandClass(value: unknown): value is CommandClass {
  return (
    typeof value === "function" &&
    value !== Command &&
    value.prototype instanceof Command
  );
}

function printAppCommandList(
  handlers: Record<string, CommandHandler>,
  cwd: string,
): void {
  console.log("Available commands:");
  const names = Object.keys(handlers).sort();
  if (names.length === 0) {
    console.log(`  (none in ${cwd}/app/Console/Commands)`);
    return;
  }
  for (const name of names) {
    console.log(`  ${name}`);
  }
}

export async function describeAppCommands(
  cwd = process.cwd(),
): Promise<Array<{ name: string; description: string }>> {
  const glob = new Glob("app/Console/Commands/**/*.{ts,js}");
  const rows: Array<{ name: string; description: string }> = [];
  for await (const file of glob.scan({ cwd })) {
    if (/\.(spec|test)\./.test(file)) {
      continue;
    }
    const mod = (await import(resolve(cwd, file))) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (!isCommandClass(value)) {
        continue;
      }
      const name = commandName(value);
      if (!name) {
        continue;
      }
      rows.push({ name, description: commandDescription(value) });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
