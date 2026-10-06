/** A tiny app: registers tools, logs noisily to stdout, then serves MCP over stdio. */
import { Mcp, protectStdout, registerBuiltinTools, serveStdio } from "../../src/index.ts";

protectStdout();
console.log("booting the app… (this must not reach stdout)");

registerBuiltinTools();
Mcp.tool({
  name: "demo_add",
  description: "Add two numbers.",
  inputSchema: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
  handler: ({ a, b }) => ({ sum: (a as number) + (b as number) }),
});
Mcp.tool({
  name: "demo_boom",
  description: "Always fails.",
  handler: () => {
    throw new Error("kaput");
  },
});

await serveStdio();
