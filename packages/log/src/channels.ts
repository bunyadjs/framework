import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  parseLevel,
  shouldLog,
  type LogLevel,
} from "./levels.ts";

export type LogChannel = {
  log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void | Promise<void>;
};

export type SingleChannelOptions = {
  path: string;
  level?: LogLevel | string;
};

export type DailyChannelOptions = {
  /** Base path, e.g. `storage/logs/app.log` → `app-YYYY-MM-DD.log`. */
  path: string;
  level?: LogLevel | string;
  /** Retain this many days of dated files (best-effort prune on write). */
  days?: number;
};

export type StackChannelOptions = {
  channels: LogChannel[];
  level?: LogLevel | string;
};

export type ConsoleChannelOptions = {
  level?: LogLevel | string;
};

function formatLine(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): string {
  const stamp = new Date().toISOString();
  const ctx =
    context && Object.keys(context).length > 0
      ? ` ${JSON.stringify(context)}`
      : "";
  return `[${stamp}] ${level.toUpperCase()}: ${message}${ctx}\n`;
}

function dateStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Write every message to one file. */
export class SingleChannel implements LogChannel {
  readonly #path: string;
  readonly #level: LogLevel;
  #ready: Promise<void> | undefined;

  constructor(options: SingleChannelOptions) {
    this.#path = options.path;
    this.#level = parseLevel(
      typeof options.level === "string" ? options.level : options.level,
      "debug",
    );
  }

  async log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    if (!shouldLog(level, this.#level)) return;
    if (!this.#ready) {
      this.#ready = mkdir(dirname(this.#path), { recursive: true }).then(
        () => undefined,
      );
    }
    await this.#ready;
    await appendFile(this.#path, formatLine(level, message, context), "utf8");
  }
}

/**
 * Daily file channel (`stem-YYYY-MM-DD.log`).
 * Prunes dated files older than `days` (best-effort, once per calendar day).
 */
export class DailyChannel implements LogChannel {
  readonly #basePath: string;
  readonly #level: LogLevel;
  readonly #days: number;
  readonly #stem: string;
  readonly #dir: string;
  #ready: Promise<void> | undefined;
  #lastPruneDay: string | undefined;

  constructor(options: DailyChannelOptions) {
    this.#basePath = options.path;
    this.#dir = dirname(options.path);
    this.#stem = basename(options.path).replace(/\.log$/i, "");
    this.#level = parseLevel(
      typeof options.level === "string" ? options.level : options.level,
      "debug",
    );
    this.#days = Math.max(1, options.days ?? 14);
  }

  #dailyPath(day = dateStamp()): string {
    return join(this.#dir, `${this.#stem}-${day}.log`);
  }

  async #pruneOldFiles(): Promise<void> {
    const today = dateStamp();
    if (this.#lastPruneDay === today) return;
    this.#lastPruneDay = today;

    let entries: string[] = [];
    try {
      entries = await readdir(this.#dir);
    } catch {
      return;
    }

    const prefix = `${this.#stem}-`;
    const cutoff = Date.now() - this.#days * 86_400_000;
    await Promise.all(
      entries.map(async (name) => {
        if (!name.startsWith(prefix) || !name.endsWith(".log")) return;
        const day = name.slice(prefix.length, -".log".length);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
        const ms = Date.parse(`${day}T00:00:00.000Z`);
        if (!Number.isFinite(ms) || ms >= cutoff) return;
        try {
          await unlink(join(this.#dir, name));
        } catch {
          // best-effort
        }
      }),
    );
  }

  async log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    if (!shouldLog(level, this.#level)) return;
    const path = this.#dailyPath();
    if (!this.#ready) {
      this.#ready = mkdir(this.#dir, { recursive: true }).then(() => undefined);
    }
    await this.#ready;
    await this.#pruneOldFiles();
    await appendFile(path, formatLine(level, message, context), "utf8");
  }
}

/** Fan out to several channels. */
export class StackChannel implements LogChannel {
  readonly #channels: LogChannel[];
  readonly #level: LogLevel;

  constructor(options: StackChannelOptions) {
    this.#channels = options.channels;
    this.#level = parseLevel(
      typeof options.level === "string" ? options.level : options.level,
      "debug",
    );
  }

  async log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    if (!shouldLog(level, this.#level)) return;
    await Promise.all(
      this.#channels.map((channel) => channel.log(level, message, context)),
    );
  }
}

/** Write to stdout / stderr (handy for tests and local stacks). */
export class ConsoleChannel implements LogChannel {
  readonly #level: LogLevel;

  constructor(options: ConsoleChannelOptions = {}) {
    this.#level = parseLevel(
      typeof options.level === "string" ? options.level : options.level,
      "debug",
    );
  }

  log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (!shouldLog(level, this.#level)) return;
    const line = formatLine(level, message, context).trimEnd();
    if (levelWeightIsError(level)) {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}

function levelWeightIsError(level: LogLevel): boolean {
  return (
    level === "error" ||
    level === "critical" ||
    level === "alert" ||
    level === "emergency"
  );
}
