import { beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
  ErrorCode,
  McpServer,
  SERVER_VERSION,
  ToolRegistry,
  protectStdout,
  serveStdio,
  validateArguments,
  type JsonRpcResponse,
} from "../src/index.ts";

let registry: ToolRegistry;
let server: McpServer;

beforeEach(() => {
  registry = new ToolRegistry();
  registry.register({
    name: "demo_echo",
    description: "Echo text.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    handler: ({ text }) => `echo: ${text}`,
  });
  registry.register({ name: "demo_json", description: "Object result.", handler: () => ({ a: 1, b: [2] }) });
  registry.register({
    name: "demo_fail",
    description: "Throws.",
    handler: () => {
      throw new Error("kaput");
    },
  });
  server = new McpServer(registry, { maxResponseChars: 50 });
});

const call = async (message: unknown) => (await server.handle(message)) as JsonRpcResponse;
const request = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: "2.0", id, method, params });

test("initialize echoes a supported protocol version and advertises tools", async () => {
  const res = (await call(request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }))) as any;
  expect(res.result.protocolVersion).toBe("2025-03-26");
  expect(res.result.capabilities).toEqual({ tools: { listChanged: false } });
  expect(res.result.serverInfo).toEqual({ name: "bunyad", version: SERVER_VERSION });
});

test("initialize falls back to the newest version for an unknown one", async () => {
  const res = (await call(request("initialize", { protocolVersion: "1999-01-01" }))) as any;
  expect(res.result.protocolVersion).toBe("2025-06-18");
});

test("notifications get no response and ping answers", async () => {
  expect(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
  expect(await server.handle({ jsonrpc: "2.0", method: "nothing/known" })).toBeUndefined();
  expect(((await call(request("ping"))) as any).result).toEqual({});
});

test("tools/list returns sorted tools with a default schema", async () => {
  const res = (await call(request("tools/list"))) as any;
  expect(res.result.tools.map((t: any) => t.name)).toEqual(["demo_echo", "demo_fail", "demo_json"]);
  expect(res.result.tools[2].inputSchema).toEqual({ type: "object" });
  expect(res.result.tools[0].inputSchema.required).toEqual(["text"]);
});

test("tools/call returns text, JSON, and passes arguments through", async () => {
  const text = (await call(request("tools/call", { name: "demo_echo", arguments: { text: "hi" } }))) as any;
  expect(text.result.content).toEqual([{ type: "text", text: "echo: hi" }]);
  const json = (await call(request("tools/call", { name: "demo_json" }))) as any;
  expect(json.result.content[0].text).toBe('{"a":1,"b":[2]}');
  expect(json.result.isError).toBeUndefined();
});

test("a failing tool is an isError result, not a protocol error", async () => {
  const res = (await call(request("tools/call", { name: "demo_fail" }))) as any;
  expect(res.error).toBeUndefined();
  expect(res.result).toEqual({ content: [{ type: "text", text: "kaput" }], isError: true });
});

test("invalid arguments are reported to the agent so it can retry", async () => {
  const res = (await call(request("tools/call", { name: "demo_echo", arguments: { text: 5 } }))) as any;
  expect(res.result.isError).toBe(true);
  expect(res.result.content[0].text).toContain("arguments.text must be a string");
  const missing = (await call(request("tools/call", { name: "demo_echo" }))) as any;
  expect(missing.result.content[0].text).toContain("arguments.text is required");
});

test("unknown tools and methods are protocol errors", async () => {
  const tool = (await call(request("tools/call", { name: "nope_nothing" }))) as any;
  expect(tool.error.code).toBe(ErrorCode.InvalidParams);
  const noName = (await call(request("tools/call", {}))) as any;
  expect(noName.error.code).toBe(ErrorCode.InvalidParams);
  const method = (await call(request("resources/list"))) as any;
  expect(method.error.code).toBe(ErrorCode.MethodNotFound);
});

test("malformed requests are rejected", async () => {
  expect(((await call({ method: "ping" })) as any).error.code).toBe(ErrorCode.InvalidRequest);
  expect(((await call("hello")) as any).error.code).toBe(ErrorCode.InvalidRequest);
  expect(((await call([])) as any).error.code).toBe(ErrorCode.InvalidRequest);
});

test("batches answer each request and skip notifications", async () => {
  const res = (await server.handle([request("ping", undefined, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, request("ping", undefined, 2)])) as any[];
  expect(res.map((r) => r.id)).toEqual([1, 2]);
});

test("long output is cut with a note so it cannot flood an agent", async () => {
  registry.register({ name: "demo_big", description: "Big.", handler: () => "x".repeat(500) });
  const res = (await call(request("tools/call", { name: "demo_big" }))) as any;
  const text = res.result.content[0].text as string;
  expect(text.startsWith("x".repeat(50))).toBe(true);
  expect(text).toContain("output cut at 50 of 500");
});

test("a handler can return content blocks directly", async () => {
  registry.register({
    name: "demo_raw",
    description: "Raw.",
    handler: () => ({ content: [{ type: "text", text: "raw" }], isError: true }),
  });
  expect(((await call(request("tools/call", { name: "demo_raw" }))) as any).result).toEqual({
    content: [{ type: "text", text: "raw" }],
    isError: true,
  });
});

test("tool names must be <package>_<action> and unique", () => {
  const r = new ToolRegistry();
  const tool = { description: "x", handler: () => "" };
  for (const bad of ["tool", "Debugbar_x", "debugbar-x", "_x", "a b_c"]) {
    expect(() => r.register({ ...tool, name: bad })).toThrow("Invalid MCP tool name");
  }
  r.register({ ...tool, name: "pkg_one" });
  expect(() => r.register({ ...tool, name: "pkg_one" })).toThrow("already registered");
});

test("validateArguments covers types, enums, ranges and nesting", () => {
  const schema = {
    type: "object" as const,
    properties: {
      limit: { type: "integer" as const, minimum: 1, maximum: 10 },
      mode: { type: "string" as const, enum: ["a", "b"] },
      ids: { type: "array" as const, items: { type: "number" as const } },
    },
    additionalProperties: false,
  };
  expect(validateArguments(schema, { limit: 5, mode: "a", ids: [1, 2] })).toEqual([]);
  expect(validateArguments(schema, { limit: 0 })).toEqual(["arguments.limit must be >= 1"]);
  expect(validateArguments(schema, { limit: 1.5 })).toEqual(["arguments.limit must be an integer"]);
  expect(validateArguments(schema, { mode: "z" })[0]).toContain("must be one of");
  expect(validateArguments(schema, { ids: [1, "x"] })).toEqual(["arguments.ids[1] must be a number"]);
  expect(validateArguments(schema, { extra: 1 })).toEqual(["arguments.extra is not allowed"]);
  expect(validateArguments(undefined, "anything")).toEqual([]);
});

test("serveStdio frames lines, tolerates chunk splits, and reports bad JSON", async () => {
  const out: string[] = [];
  const whole = JSON.stringify(request("ping", undefined, 7)) + "\n";
  const input = (async function* () {
    yield whole.slice(0, 10); // split mid-message
    yield whole.slice(10);
    yield "not json\n";
    yield JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n\n";
    yield JSON.stringify(request("ping", undefined, 8)); // no trailing newline
  })();
  await serveStdio({ input, write: (line) => out.push(line) });

  const parsed = out.map((line) => JSON.parse(line));
  expect(parsed.find((m) => m.id === 7).result).toEqual({});
  expect(parsed.find((m) => m.id === 8).result).toEqual({});
  expect(parsed.find((m) => m.error?.code === ErrorCode.ParseError)).toBeTruthy();
  expect(parsed).toHaveLength(3);
});

test("protectStdout sends console.log to stderr and restores it", () => {
  const original = console.log;
  const restore = protectStdout();
  expect(console.log).toBe(console.error);
  restore();
  expect(console.log).toBe(original);
});

test("a real child process speaks MCP over stdio with stdout kept clean", async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/server.ts")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + "\n");
  send(request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }, 1));
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send(request("tools/list", undefined, 2));
  send(request("tools/call", { name: "demo_add", arguments: { a: 2, b: 3 } }, 3));
  send(request("tools/call", { name: "demo_boom" }, 4));
  send(request("tools/call", { name: "mcp_info" }, 5));
  child.stdin.end();

  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  await child.exited;

  const lines = stdout.trim().split("\n");
  const messages = lines.map((line) => JSON.parse(line)); // would throw on a stray log line
  expect(messages).toHaveLength(5);
  const byId = (id: number) => messages.find((m) => m.id === id);
  expect(byId(1).result.serverInfo.name).toBe("bunyad");
  expect(byId(2).result.tools.map((t: any) => t.name)).toEqual(["demo_add", "demo_boom", "mcp_info"]);
  expect(byId(3).result.content[0].text).toBe('{"sum":5}');
  expect(byId(4).result.isError).toBe(true);
  expect(JSON.parse(byId(5).result.content[0].text).tools).toContain("demo_add");
  expect(stderr).toContain("booting the app");
});

test("the advertised server version matches package.json", async () => {
  const pkg = await Bun.file(join(import.meta.dir, "../package.json")).json();
  expect(SERVER_VERSION).toBe(pkg.version);
});
