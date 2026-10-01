import { Command, parseSignature } from "./command.ts";
import { registerClosureCommand } from "./command-registry.ts";

type ClosureHandler = (
  this: Command,
) => void | Promise<void | number>;

/**
 * Register a closure console command.
 *
 * ```ts
 * Console.command("mail:send {user}", async function () {
 *   this.info(`Sending to ${this.argument("user")}`);
 * });
 * ```
 */
export function command(signature: string, handler: ClosureHandler): void {
  const parsed = parseSignature(signature);
  if (!parsed.name) {
    throw new Error("Console.command requires a command name in the signature.");
  }

  class ClosureCommand extends Command {
    static override signature = signature;
    override async handle(): Promise<number | void> {
      return handler.call(this);
    }
  }

  registerClosureCommand(parsed.name, async (argv) => {
    const cmd = new ClosureCommand();
    cmd.bindInput(argv);
    if (!(await cmd.ensureRequiredArguments())) {
      process.exitCode = 1;
      return;
    }
    const code = await cmd.handle();
    if (typeof code === "number") {
      process.exitCode = code;
    }
  });
}

export const Console = {
  command,
};
