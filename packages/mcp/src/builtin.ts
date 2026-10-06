import { registry } from "./registry.ts";
import { SERVER_VERSION } from "./server.ts";

/** Register the tools every app gets. Safe to call more than once. */
export function registerBuiltinTools(): void {
  if (registry.get("mcp_info")) return;
  registry.register({
    name: "mcp_info",
    description: "Describe this MCP server: its version and the names of every registered tool.",
    handler: () => ({
      server: "bunyad",
      version: SERVER_VERSION,
      cwd: process.cwd(),
      tools: registry.list().map((tool) => tool.name),
    }),
  });
}
