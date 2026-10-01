import type { Application } from "./application.ts";
import {
  commandNameFromCtor,
  registerProviderCommand,
  type CommandHandler,
} from "./provider-commands.ts";

/**
 * Base service provider — `register()` then `boot()` after all providers register.
 */
export abstract class ServiceProvider {
  constructor(protected app: Application) {}

  register(): void {}

  boot(): void | Promise<void> {}

  /**
   * Publish package paths into the application (`bunyad publish`).
   * `paths` maps source → destination (relative to the app root unless absolute).
   */
  protected publishes(
    paths: Record<string, string>,
    group = "default",
  ): void {
    type PublishEntry = { group: string; from: string; to: string };
    const key = "bunyad.publishing";
    const existing =
      (this.app.has(key)
        ? this.app.make<PublishEntry[]>(key)
        : undefined) ?? [];
    for (const [from, to] of Object.entries(paths)) {
      existing.push({ group, from, to });
    }
    this.app.instance(key, existing);
  }

  /**
   * Register console command classes from this provider.
   */
  protected commands(
    ctors: Array<
      (new () => {
        bindInput(args: string[]): unknown;
        ensureRequiredArguments(): Promise<boolean>;
        handle(): Promise<number | void>;
      }) & { signature?: string }
    >,
  ): void {
    for (const Ctor of ctors) {
      const name = commandNameFromCtor(Ctor);
      if (!name) continue;
      const handler: CommandHandler = async (args) => {
        const command = new Ctor();
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
      registerProviderCommand(name, handler);
    }
  }
}

export type ServiceProviderClass = new (
  app: Application,
) => ServiceProvider;
