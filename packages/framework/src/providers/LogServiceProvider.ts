import { isAbsolute, join } from "node:path";
import { ServiceProvider } from "@bunyad/core";
import {
  ConsoleChannel,
  DailyChannel,
  SingleChannel,
  StackChannel,
  setDefaultLogChannel,
  setLogChannel,
  type LogChannel,
  type LogLevel,
} from "@bunyad/log";

export type LoggingChannelConfig = {
  driver?: string;
  path?: string;
  level?: string;
  channels?: string[];
  /** Retention for the `daily` driver (dated files to keep). */
  days?: number;
};

export type LoggingConfig = {
  default?: string;
  channels?: Record<string, LoggingChannelConfig>;
};

/**
 * Build log channels from `config/logging.ts` and register the `Log` façade.
 * Supports Laravel-ish drivers: `single`, `daily`, `stack`, `console`.
 *
 * Channels are wired in `boot()` so `Application.configure().create()` apps
 * (config loads at the start of `boot()`) see `config/logging.ts`. Apps that
 * call `bootFrameworkProviders` / `loadFrameworkConfig` first also work —
 * config is already present when `boot()` runs.
 */
export class LogServiceProvider extends ServiceProvider {
  register(): void {
    // Channel build needs `config/logging` — see `boot()`.
  }

  boot(): void {
    const config = this.app.config.get<LoggingConfig>("logging") ?? {};
    const channelsConfig = config.channels ?? {
      stack: { driver: "stack", channels: ["single"], level: "debug" },
      single: {
        driver: "single",
        path: this.app.storagePath("logs/bunyad.log"),
        level: process.env.LOG_LEVEL ?? "debug",
      },
      console: {
        driver: "console",
        level: process.env.LOG_LEVEL ?? "debug",
      },
    };

    const resolvePath = (path: string | undefined): string => {
      const raw = path ?? this.app.storagePath("logs/bunyad.log");
      return isAbsolute(raw) ? raw : join(this.app.basePath(), raw);
    };

    const built = new Map<string, LogChannel>();

    const build = (name: string, visiting = new Set<string>()): LogChannel => {
      if (built.has(name)) return built.get(name)!;
      if (visiting.has(name)) {
        throw new Error(`Cyclic log channel stack involving [${name}].`);
      }
      visiting.add(name);
      const entry = channelsConfig[name] ?? { driver: name };
      const driver = entry.driver ?? name;
      const level = (entry.level ??
        process.env.LOG_LEVEL ??
        "debug") as LogLevel;

      let channel: LogChannel;
      if (driver === "single") {
        channel = new SingleChannel({
          path: resolvePath(entry.path),
          level,
        });
      } else if (driver === "daily") {
        channel = new DailyChannel({
          path: resolvePath(entry.path),
          level,
          days: entry.days,
        });
      } else if (driver === "console") {
        channel = new ConsoleChannel({ level });
      } else if (driver === "stack") {
        const names = entry.channels ?? ["single"];
        channel = new StackChannel({
          level,
          channels: names.map((child) => build(child, visiting)),
        });
      } else {
        channel = new ConsoleChannel({ level });
      }

      built.set(name, channel);
      setLogChannel(channel, name);
      visiting.delete(name);
      return channel;
    };

    for (const name of Object.keys(channelsConfig)) {
      build(name);
    }

    const defaultName = config.default ?? process.env.LOG_CHANNEL ?? "stack";
    if (!built.has(defaultName)) {
      build(defaultName);
    }
    setDefaultLogChannel(defaultName);
  }
}
