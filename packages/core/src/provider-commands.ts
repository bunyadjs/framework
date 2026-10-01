/** Lightweight command registration shared by providers and the CLI. */

export type CommandHandler = (args: string[]) => Promise<void>;

const providerHandlers = new Map<string, CommandHandler>();

export function registerProviderCommand(
  name: string,
  handler: CommandHandler,
): void {
  providerHandlers.set(name, handler);
}

export function getProviderCommandHandlers(): Record<string, CommandHandler> {
  return Object.fromEntries(providerHandlers);
}

export function clearProviderCommands(): void {
  providerHandlers.clear();
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
