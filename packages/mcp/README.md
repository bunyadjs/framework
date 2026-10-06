# @bunyad/mcp

One [MCP](https://modelcontextprotocol.io) server per Bunyad app. Packages register tools; an AI agent in your editor connects over stdio and calls them. There is no separate server per package, so the editor config has a single entry.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add -d @bunyad/mcp@beta
# or: npm install -D @bunyad/mcp@beta
```

## Connect an editor

Add one entry to the editor's MCP settings (for Claude Code, a `.mcp.json` in the app root):

```json
{
  "mcpServers": {
    "my-app": { "command": "bun", "args": ["bunyad", "mcp"] }
  }
}
```

`bunyad mcp` boots your app, so providers can register their tools, then serves MCP over stdin/stdout until the editor disconnects. The built-in `mcp_info` tool lists everything that is registered.

## Register a tool

```ts
import { Mcp } from "@bunyad/mcp";

Mcp.tool({
  name: "orders_find",              // <package>_<action>, lower case
  description: "Find an order by its number.",
  inputSchema: {
    type: "object",
    properties: { number: { type: "string" } },
    required: ["number"],
  },
  handler: async ({ number }) => findOrder(String(number)), // string, object or array
});
```

Do it from a service provider's `boot()` so it runs for `bunyad mcp` and for the web server alike.

- A string result is returned as text; an object or array as compact JSON.
- Arguments are checked against `inputSchema` (types, `required`, `enum`, `minimum`/`maximum`, nested objects and arrays). A mismatch comes back to the agent as an error it can read and retry.
- A thrown error becomes an error result with its message, not a protocol failure.
- Output longer than 60 000 characters is cut with a note telling the agent to ask for less. Return summaries and let agents ask for detail.
- Names must be `<package>_<action>`; a bad or duplicate name throws at boot.

## What it supports

JSON-RPC 2.0 over newline-delimited stdio: `initialize` (protocol versions 2025-06-18, 2025-03-26, 2024-11-05), `ping`, `tools/list` and `tools/call`. It has been exercised with the official MCP SDK client. Resources, prompts and an HTTP transport are not implemented yet.

## stdout belongs to the protocol

One stray line on stdout corrupts the stream. `bunyad mcp` routes `console.log`, `console.info` and `console.debug` to stderr before it boots the app, so boot logs and your own logging are safe. Writing to `process.stdout` directly is not; don't.

## Use it from your own entry point

```ts
import { protectStdout, registerBuiltinTools, serveStdio } from "@bunyad/mcp";

protectStdout();
// ...boot your app and register tools...
registerBuiltinTools();
await serveStdio();
```

`McpServer` is transport-agnostic: `await server.handle(message)` takes one parsed JSON-RPC message and returns the response, which is how the tests drive it.

## Security

stdio is local to your machine and the editor that launched it. Tools run with your app's full access, so register only tools you are happy for an agent to call, and keep them read-only unless you have a reason. Never return secrets from a tool.
