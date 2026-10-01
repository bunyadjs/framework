import { expect, test } from "bun:test";
import { resolve } from "node:path";

const playground = resolve(import.meta.dir, "../../../apps/playground");

async function routeList(args: string[] = []): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["bun", "./bunyad", "route:list", ...args], {
    cwd: playground,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

test("route:list prints Method URI Name Action Middleware", async () => {
  const { code, stdout, stderr } = await routeList();
  expect(code).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toContain("Method");
  expect(stdout).toContain("URI");
  expect(stdout).toContain("Name");
  expect(stdout).toContain("Action");
  expect(stdout).toContain("Middleware");
  expect(stdout).toContain("home");
  expect(stdout).toMatch(/HelloController@index/);
  expect(stdout).toContain("users.show");
  expect(stdout).toMatch(/UserController@show/);
});

test("route:list --json emits filterable rows", async () => {
  const { code, stdout } = await routeList(["--json"]);
  expect(code).toBe(0);
  const rows = JSON.parse(stdout) as {
    method: string;
    uri: string;
    name: string;
    action: string;
    middleware: string;
  }[];
  expect(rows.length).toBeGreaterThan(10);
  const home = rows.find((r) => r.name === "home");
  expect(home?.method).toBe("GET");
  expect(home?.uri).toBe("/");
  expect(home?.action).toBe("HelloController@index");
});

test("route:list --method=POST --name=login filters", async () => {
  const { code, stdout } = await routeList([
    "--json",
    "--method=POST",
    "--name=login",
  ]);
  expect(code).toBe(0);
  const rows = JSON.parse(stdout) as { method: string; name: string }[];
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.method).toContain("POST");
    expect(row.name).toContain("login");
  }
});

test("route:list --path=api filters by URI", async () => {
  const { code, stdout } = await routeList(["--json", "--path=api"]);
  expect(code).toBe(0);
  const rows = JSON.parse(stdout) as { uri: string }[];
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.uri).toContain("api");
  }
});
