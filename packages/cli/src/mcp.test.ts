import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("`bunyad mcp` boots the app, serves its tools, and keeps boot logs off stdout", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-mcp-cli-"));
  await mkdir(join(root, "bootstrap"), { recursive: true });
  await writeFile(
    join(root, "bootstrap/app.ts"),
    `import { Mcp } from ${JSON.stringify(import.meta.resolve("@bunyad/mcp"))};
export async function createApplication() {
  console.log("BOOT LOG that must stay off stdout");
  Mcp.tool({ name: "shop_ping", description: "Ping.", handler: () => ({ pong: true }) });
}
`,
  );

  const child = Bun.spawn([process.execPath, join(import.meta.dir, "bunyad.ts"), "mcp"], {
    cwd: root,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "shop_ping" } });
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "mcp_info" } });
  child.stdin.end();

  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  await child.exited;

  const messages = stdout.trim().split("\n").map((line) => JSON.parse(line)); // a stray log line would throw here
  const byId = (id: number) => messages.find((m) => m.id === id);
  expect(messages).toHaveLength(4);
  expect(byId(2).result.tools.map((t: any) => t.name)).toEqual(["mcp_info", "shop_ping"]);
  expect(byId(3).result.content[0].text).toBe('{"pong":true}');
  expect(JSON.parse(byId(4).result.content[0].text).tools).toEqual(["mcp_info", "shop_ping"]);
  expect(stdout).not.toContain("BOOT LOG");
  expect(stderr).toContain("BOOT LOG that must stay off stdout");
});
