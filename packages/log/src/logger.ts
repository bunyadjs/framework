import type { LogChannel } from "./channels.ts";
import type { LogLevel } from "./levels.ts";

let defaultChannel: LogChannel | undefined;
const named = new Map<string, LogChannel>();
let sharedContext: Record<string, unknown> = {};

/** Serial queue of in-flight channel writes; flushed via `Log.flush()`. */
let writeQueue: Promise<void> = Promise.resolve();

export function setLogChannel(channel: LogChannel, name = "default"): void {
  named.set(name, channel);
  if (name === "default" || !defaultChannel) {
    defaultChannel = channel;
  }
}

export function setDefaultLogChannel(name: string): void {
  const channel = named.get(name);
  if (!channel) {
    throw new Error(`Log channel [${name}] is not defined.`);
  }
  defaultChannel = channel;
}

export function getLogChannel(name?: string): LogChannel {
  if (name) {
    const channel = named.get(name);
    if (!channel) {
      throw new Error(`Log channel [${name}] is not defined.`);
    }
    return channel;
  }
  if (!defaultChannel) {
    throw new Error("Log channel has not been set. Register LogServiceProvider.");
  }
  return defaultChannel;
}

export function resetLogChannelsForTests(): void {
  defaultChannel = undefined;
  named.clear();
  sharedContext = {};
  writeQueue = Promise.resolve();
}

type LogMethod = (
  message: string,
  context?: Record<string, unknown>,
) => void;

function mergeContext(
  context?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (Object.keys(sharedContext).length === 0) return context;
  return { ...sharedContext, ...context };
}

/**
 * Queue work so channel I/O starts only after prior writes finish.
 * Callers snapshot args synchronously before enqueueing.
 */
function enqueueWrite(work: () => void | Promise<void>): void {
  writeQueue = writeQueue.then(async () => {
    try {
      await work();
    } catch {
      // Keep the queue alive after a failed write.
    }
  });
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const channel = getLogChannel();
  const merged = mergeContext(context);
  enqueueWrite(() => channel.log(level, message, merged));
}

function flushWrites(): Promise<void> {
  return writeQueue;
}

function channelApi(channel: LogChannel) {
  return {
    debug: ((message, context) => {
      const merged = mergeContext(context);
      enqueueWrite(() => channel.log("debug", message, merged));
    }) as LogMethod,
    info: ((message, context) => {
      const merged = mergeContext(context);
      enqueueWrite(() => channel.log("info", message, merged));
    }) as LogMethod,
    notice: ((message, context) => {
      const merged = mergeContext(context);
      enqueueWrite(() => channel.log("notice", message, merged));
    }) as LogMethod,
    warning: ((message, context) => {
      const merged = mergeContext(context);
      enqueueWrite(() => channel.log("warning", message, merged));
    }) as LogMethod,
    error: ((message, context) => {
      const merged = mergeContext(context);
      enqueueWrite(() => channel.log("error", message, merged));
    }) as LogMethod,
    critical: ((message, context) => {
      const merged = mergeContext(context);
      enqueueWrite(() => channel.log("critical", message, merged));
    }) as LogMethod,
    alert: ((message, context) => {
      const merged = mergeContext(context);
      enqueueWrite(() => channel.log("alert", message, merged));
    }) as LogMethod,
    emergency: ((message, context) => {
      const merged = mergeContext(context);
      enqueueWrite(() => channel.log("emergency", message, merged));
    }) as LogMethod,
    log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
      const merged = mergeContext(context);
      enqueueWrite(() => channel.log(level, message, merged));
    },
    shareContext(context: Record<string, unknown>) {
      sharedContext = { ...sharedContext, ...context };
      return this;
    },
    withContext(context: Record<string, unknown>) {
      sharedContext = { ...sharedContext, ...context };
      return this;
    },
    withoutContext() {
      sharedContext = {};
      return this;
    },
    sharedContext(): Record<string, unknown> {
      return { ...sharedContext };
    },
    /** Drain queued writes for this façade (same global queue as `Log.flush`). */
    flush(): Promise<void> {
      return flushWrites();
    },
  };
}

/** Log façade with optional shared context bag. Level methods are sync for callers. */
export const Log = {
  channel(name: string) {
    return channelApi(getLogChannel(name));
  },

  /** Merge values into every subsequent log line until flushed. */
  shareContext(context: Record<string, unknown>) {
    sharedContext = { ...sharedContext, ...context };
    return this;
  },

  /** Alias of `shareContext`. */
  withContext(context: Record<string, unknown>) {
    return this.shareContext(context);
  },

  /** Clear the shared context bag. */
  withoutContext() {
    sharedContext = {};
    return this;
  },

  /** Snapshot of the shared context bag. */
  sharedContext(): Record<string, unknown> {
    return { ...sharedContext };
  },

  /**
   * Await pending channel writes (shutdown / tests).
   * Level methods return void and queue I/O internally.
   */
  flush(): Promise<void> {
    return flushWrites();
  },

  debug: ((message, context) => write("debug", message, context)) as LogMethod,
  info: ((message, context) => write("info", message, context)) as LogMethod,
  notice: ((message, context) => write("notice", message, context)) as LogMethod,
  warning: ((message, context) => write("warning", message, context)) as LogMethod,
  error: ((message, context) => write("error", message, context)) as LogMethod,
  critical: ((message, context) =>
    write("critical", message, context)) as LogMethod,
  alert: ((message, context) => write("alert", message, context)) as LogMethod,
  emergency: ((message, context) =>
    write("emergency", message, context)) as LogMethod,

  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    write(level, message, context);
  },
};
