---
title: MCP Server
description: Expose your application's tools to an AI agent in your editor through one MCP server.
---

# MCP Server

## Introduction

[MCP](https://modelcontextprotocol.io) (the Model Context Protocol) lets an AI agent in your editor call tools that your application provides. `@bunyad/mcp` runs one MCP server for the whole application: packages and your own code register tools, and the editor starts the server and calls them. The editor configuration has a single entry, however many tools there are.

A tool is a named function with a description and an input schema. An agent can ask a tool for data, such as the slowest requests your [debug bar](/docs/1.x/debugbar) recorded, and use the answer in the conversation.

## Installation

Install the package as a development dependency:

```shell
bun add -d @bunyad/mcp@beta
```

You do not need to register anything. `bunyad mcp` is a console command that boots your application and then serves its tools.

## Connecting an editor

Editors that support MCP start the server themselves from a command you give them. Add one entry to the editor's MCP settings. In Claude Code, put it in a `.mcp.json` file in the root of your project:

```json title=".mcp.json"
{
  "mcpServers": {
    "my-app": { "command": "bun", "args": ["bunyad", "mcp"] }
  }
}
```

Open the editor from the application's directory, so the command runs in your app. Approve the server when the editor asks, and the agent can list and call your tools. The built-in `mcp_info` tool returns the server's version and the name of every registered tool, which is a quick way to check the connection.

:::note
`bunyad mcp` runs until the editor disconnects. You do not start it yourself.
:::

## Registering tools

Register a tool with `Mcp.tool()` from a [service provider](/docs/1.x/providers)'s `boot()` method. `bunyad mcp` boots your providers, so the tool is available to it:

```ts title="app/Providers/OrdersServiceProvider.ts"
import { ServiceProvider } from "@bunyad/core";
import { Mcp } from "@bunyad/mcp";
import Order from "../Models/Order.ts";

export default class OrdersServiceProvider extends ServiceProvider {
  boot(): void {
    Mcp.tool({
      name: "orders_find",
      description: "Find an order by its number.",
      inputSchema: {
        type: "object",
        properties: { number: { type: "string" } },
        required: ["number"],
      },
      handler: async ({ number }) => {
        const order = await Order.where("number", String(number)).first();
        return order ? order.toJSON() : "No order with that number.";
      },
    });
  }
}
```

The agent reads the description and the schema to decide when and how to call the tool, so write them for the agent: say what the tool returns and what each argument means.

### Names

A name has the form `package_action` in lower case, such as `orders_find` or `debugbar_routes`. The prefix keeps tools from different packages apart. A name that does not match, or one that is already registered, throws when the application boots, so register each tool once.

### Arguments

The `inputSchema` is a JSON Schema. Before your handler runs, the server checks the arguments against it: types, `required`, `enum`, `minimum` and `maximum`, and nested objects and arrays. When the arguments do not match, the agent receives a message that says what is wrong and can try again. Your handler only sees valid arguments.

### Results

Return a string to send it as text, or an object or array to send it as compact JSON. If your handler throws, the agent receives the error message as an error result and the server keeps running.

Output longer than 60,000 characters is cut, with a note telling the agent to ask for less. Return a summary and let the agent ask for detail with a filter, a limit or an id.

## Tools from the debug bar

When the [debug bar](/docs/1.x/debugbar) is on, it registers seven tools that read its history of recorded requests:

| Tool | What it answers |
| --- | --- |
| `debugbar_list_requests` | Which requests were recorded, with status, time and problem counts. Filter by method, status, path, slowness, errors, N+1 or kind |
| `debugbar_get_request` | What happened in one request and what looks wrong. Ask for sections, or for one exact value by JSON Pointer |
| `debugbar_queries` | The SQL one request ran, with timing, values and the file and line that issued it |
| `debugbar_hot_queries` | Which query shapes cost the most across all recorded requests, and which run in nearly every one |
| `debugbar_routes` | Per-route hits, average and worst time, queries, duplicates, N+1 and errors |
| `debugbar_exceptions` | Server errors with stack traces |
| `debugbar_logs` | Log lines written during one request |

Set the debug bar's `driver` to `"file"` for these. The MCP server is a separate process from your web server, so it can only read history that was written to disk. With the default in-memory driver, each tool says that no history is visible and how to fix it. Values were already masked before they were stored, so an agent never sees them.

## Using your own entry point

If you run console commands through your own entry file instead of the `bunyad` command, add an `mcp` command that protects standard output, boots the application, and serves:

```ts title="app/Console/Commands/McpCommand.ts"
import { Command } from "@bunyad/cli/command";

export default class McpCommand extends Command {
  static signature = "mcp";
  static description = "Serve this application's tools to an AI agent over stdio.";

  async handle(): Promise<number> {
    const { protectStdout, registerBuiltinTools, serveStdio } = await import("@bunyad/mcp");
    protectStdout();
    const { createApplication } = await import("../../../bootstrap/app.ts");
    await createApplication();
    registerBuiltinTools();
    await serveStdio();
    return 0;
  }
}
```

Call `protectStdout()` before anything else boots. The editor and the server talk over standard output, and a single stray line there corrupts the conversation. `protectStdout()` sends `console.log`, `console.info` and `console.debug` to standard error instead, so your boot logs and your own logging are safe. Writing to `process.stdout` directly is not, so do not.

## Security

The server talks to the editor that started it, over standard input and output on your machine. It opens no port.

A tool runs with your application's full access to its database, files and services. Register only tools you are happy for an agent to call, and keep them read-only unless you have a reason. Never return secrets from a tool, and remember that what a tool returns is sent to the model your editor uses.
