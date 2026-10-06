import { ErrorCode } from "./protocol.ts";
import { registry } from "./registry.ts";
import { McpServer, type McpServerOptions } from "./server.ts";

/** Captured before anything can patch it: protocol output must always reach the real stdout. */
const writeStdout = (chunk: string): void => {
  process.stdout.write(chunk);
};

/**
 * stdout carries only protocol messages. Send anything the app logs with console.log/info/debug
 * to stderr instead; one stray line there would corrupt the stream. Call before booting the app.
 * Returns a function that restores the console.
 */
export function protectStdout(): () => void {
  const original = { log: console.log, info: console.info, debug: console.debug };
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;
  return () => {
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
  };
}

export type ServeStdioOptions = McpServerOptions & {
  /** Newline-delimited JSON-RPC in. Defaults to stdin. */
  input?: AsyncIterable<Uint8Array | string>;
  /** One serialized message out (newline added). Defaults to stdout. */
  write?: (line: string) => void;
};

/** Serve MCP over stdio until the client closes its end. */
export async function serveStdio(options: ServeStdioOptions = {}): Promise<void> {
  const server = new McpServer(registry, options);
  const input = options.input ?? process.stdin;
  const write = options.write ?? ((line: string) => writeStdout(`${line}\n`));
  const decoder = new TextDecoder();
  const inflight = new Set<Promise<void>>();

  const process_ = async (line: string) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: ErrorCode.ParseError, message: "Invalid JSON." } }));
      return;
    }
    const response = await server.handle(message);
    if (response !== undefined) write(JSON.stringify(response));
  };

  const dispatch = (line: string) => {
    if (!line.trim()) return;
    // Concurrent: a slow tool must not block `ping` or another call.
    const task = process_(line).finally(() => inflight.delete(task));
    inflight.add(task);
  };

  let buffer = "";
  for await (const chunk of input) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      dispatch(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  dispatch(buffer);
  await Promise.all(inflight);
}
