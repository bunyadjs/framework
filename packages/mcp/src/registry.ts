import type { JsonSchema } from "./schema.ts";

export type ToolContent = { type: "text"; text: string };

/** A string is returned as text, an object as compact JSON; `{ content, isError }` is passed through. */
export type ToolResult =
  | string
  | { content: ToolContent[]; isError?: boolean }
  | Record<string, unknown>
  | unknown[];

export type McpTool = {
  /** `<package>_<action>`, lower case: `debugbar_list_requests`. */
  name: string;
  description: string;
  inputSchema?: JsonSchema;
  handler: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
};

const NAME = /^[a-z][a-z0-9]*_[a-z0-9_]+$/;

/** One registry per app: packages add tools, the server lists and calls them. */
export class ToolRegistry {
  readonly #tools = new Map<string, McpTool>();

  register(tool: McpTool): void {
    if (!NAME.test(tool.name) || tool.name.length > 128) {
      throw new Error(
        `Invalid MCP tool name "${tool.name}". Use <package>_<action> in lower case, e.g. "debugbar_list_requests".`,
      );
    }
    if (this.#tools.has(tool.name)) {
      throw new Error(`MCP tool "${tool.name}" is already registered.`);
    }
    this.#tools.set(tool.name, tool);
  }

  get(name: string): McpTool | undefined {
    return this.#tools.get(name);
  }

  list(): McpTool[] {
    return [...this.#tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  forget(name?: string): void {
    if (name === undefined) this.#tools.clear();
    else this.#tools.delete(name);
  }
}

/** The app-wide registry. */
export const registry = new ToolRegistry();

export const Mcp = {
  /** Register a tool. Throws on a bad or duplicate name so mistakes surface at boot. */
  tool(tool: McpTool): void {
    registry.register(tool);
  },
  tools(): McpTool[] {
    return registry.list();
  },
  /** Remove one tool, or all (tests). */
  forget(name?: string): void {
    registry.forget(name);
  },
};
