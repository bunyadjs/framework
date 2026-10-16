import {
  describeProviderCommands as describeCoreProviderCommands,
  getProviderCommandHandlers as getCoreProviderHandlers,
  registerProviderCommand as registerCoreProviderCommand,
  type CommandHandler,
} from "@bunyad/core";

export type { CommandHandler };

const closureHandlers = new Map<string, CommandHandler>();

/** Register a closure command (`Console.command('mail:send {user}', …)`). */
export function registerClosureCommand(
  name: string,
  handler: CommandHandler,
): void {
  closureHandlers.set(name, handler);
}

export function registerProviderCommand(
  name: string,
  handler: CommandHandler,
  description?: string,
): void {
  registerCoreProviderCommand(name, handler, description);
}

/** Provider/package commands with descriptions (for `bunyad list`). */
export function describeProviderCommands(): Array<{
  name: string;
  description: string;
}> {
  return describeCoreProviderCommands();
}

export function getClosureCommandHandlers(): Record<string, CommandHandler> {
  return Object.fromEntries(closureHandlers);
}

export function getProviderCommandHandlers(): Record<string, CommandHandler> {
  return getCoreProviderHandlers();
}

export function clearRegisteredCommands(): void {
  closureHandlers.clear();
}

/** Convert `{ user: "ada", queue: true }` style args into argv tokens. */
export function argvFromCallArgs(
  args?: string[] | Record<string, string | boolean | number | undefined>,
): string[] {
  if (args == null) return [];
  if (Array.isArray(args)) return args.map(String);
  const out: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    if (typeof value === "boolean") {
      if (value) out.push(`--${key}`);
      continue;
    }
    out.push(String(value));
  }
  return out;
}
