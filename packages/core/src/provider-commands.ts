/** Lightweight command registration shared by providers and the CLI. */

export type CommandHandler = (args: string[]) => Promise<void>;

const providerHandlers = new Map<string, CommandHandler>();
const providerDescriptions = new Map<string, string>();

/**
 * Register a command from a package/service provider. `description` is shown
 * by `bunyad list` under "Package commands".
 */
export function registerProviderCommand(
  name: string,
  handler: CommandHandler,
  description?: string,
): void {
  providerHandlers.set(name, handler);
  if (description) providerDescriptions.set(name, description);
  else providerDescriptions.delete(name);
}

/** Registered provider commands with descriptions, sorted by name. */
export function describeProviderCommands(): Array<{
  name: string;
  description: string;
}> {
  return [...providerHandlers.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      description: providerDescriptions.get(name) ?? "",
    }));
}

export function getProviderCommandHandlers(): Record<string, CommandHandler> {
  return Object.fromEntries(providerHandlers);
}

export function clearProviderCommands(): void {
  providerHandlers.clear();
  providerDescriptions.clear();
}

/** Extract `mail:send` from a Command class with static `signature`. */
export function commandNameFromCtor(ctor: {
  signature?: string;
  name?: string;
}): string {
  const signature = ctor.signature ?? "";
  if (!signature) return "";
  const brace = signature.search(/\s*\{/);
  return (brace === -1 ? signature : signature.slice(0, brace)).trim();
}
