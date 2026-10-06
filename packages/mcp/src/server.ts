import { ErrorCode, SUPPORTED_PROTOCOL_VERSIONS, type JsonRpcId, type JsonRpcResponse } from "./protocol.ts";
import { type McpTool, type ToolContent, type ToolRegistry, type ToolResult } from "./registry.ts";
import { validateArguments } from "./schema.ts";

export const SERVER_VERSION = "0.2.0-beta.0";

export type McpServerOptions = {
  name?: string;
  version?: string;
  /** Shown to the agent on connect; say what this app's tools are for. */
  instructions?: string;
  /** Longer tool output is cut with a note, so one call cannot flood an agent's context. Default 60 000. */
  maxResponseChars?: number;
};

const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
const fail = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** MCP over JSON-RPC 2.0: `initialize`, `ping`, `tools/list`, `tools/call`. Transport-agnostic. */
export class McpServer {
  readonly #maxChars: number;

  constructor(
    private readonly tools: ToolRegistry,
    private readonly options: McpServerOptions = {},
  ) {
    this.#maxChars = options.maxResponseChars ?? 60_000;
  }

  /** Handle one parsed message (or a batch). Returns nothing for notifications. */
  async handle(message: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | undefined> {
    if (Array.isArray(message)) {
      if (message.length === 0) return fail(null, ErrorCode.InvalidRequest, "Empty batch.");
      const out = (await Promise.all(message.map((item) => this.#one(item)))).filter(
        (item): item is JsonRpcResponse => item !== undefined,
      );
      return out.length ? out : undefined;
    }
    return this.#one(message);
  }

  async #one(message: unknown): Promise<JsonRpcResponse | undefined> {
    if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      const id = isRecord(message) && (typeof message.id === "string" || typeof message.id === "number") ? message.id : null;
      return fail(id, ErrorCode.InvalidRequest, "Not a JSON-RPC 2.0 request.");
    }
    const hasId = message.id !== undefined;
    const id = (hasId ? message.id : null) as JsonRpcId;
    const params = isRecord(message.params) ? message.params : {};

    try {
      const result = await this.#dispatch(message.method, params);
      if (!hasId) return undefined; // notification: never answer
      if (result === NOT_FOUND) return fail(id, ErrorCode.MethodNotFound, `Method not found: ${message.method}`);
      return ok(id, result);
    } catch (error) {
      if (!hasId) return undefined;
      if (error instanceof ProtocolError) return fail(id, error.code, error.message);
      return fail(id, ErrorCode.InternalError, error instanceof Error ? error.message : String(error));
    }
  }

  async #dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const supported = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked);
        return {
          protocolVersion: supported ? asked : SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: this.options.name ?? "bunyad", version: this.options.version ?? SERVER_VERSION },
          ...(this.options.instructions ? { instructions: this.options.instructions } : {}),
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: this.tools.list().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema ?? { type: "object" },
          })),
        };
      case "tools/call":
        return this.#call(params);
      default:
        return method.startsWith("notifications/") ? undefined : NOT_FOUND;
    }
  }

  async #call(params: Record<string, unknown>) {
    const name = params.name;
    if (typeof name !== "string") throw new ProtocolError(ErrorCode.InvalidParams, "tools/call needs a tool name.");
    const tool = this.tools.get(name);
    if (!tool) throw new ProtocolError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);

    const args = params.arguments ?? {};
    const problems = validateArguments(tool.inputSchema, args);
    if (problems.length) return this.#error(`Invalid arguments for ${name}:\n- ${problems.join("\n- ")}`);

    try {
      return this.#format(await tool.handler(args as Record<string, unknown>));
    } catch (error) {
      // A tool failure is a result the agent can read and react to, not a protocol error.
      return this.#error(error instanceof Error ? error.message : String(error));
    }
  }

  #error(text: string) {
    return { content: [{ type: "text", text }], isError: true };
  }

  #format(result: ToolResult): { content: ToolContent[]; isError?: boolean } {
    if (isRecord(result) && Array.isArray(result.content)) {
      return result as { content: ToolContent[]; isError?: boolean };
    }
    const text = typeof result === "string" ? result : (JSON.stringify(result) ?? "null");
    return { content: [{ type: "text", text: this.#cap(text) }] };
  }

  #cap(text: string): string {
    if (text.length <= this.#maxChars) return text;
    return `${text.slice(0, this.#maxChars)}\n… output cut at ${this.#maxChars} of ${text.length} characters. Ask for less (a filter, a limit, or one section).`;
  }
}

const NOT_FOUND = Symbol("not-found");

class ProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export type { McpTool };
