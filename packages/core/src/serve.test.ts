import { afterEach, expect, test } from "bun:test";
import { Router } from "@bunyad/router";
import { Application, serve } from "../src/index.ts";

const opened: { stop(force?: boolean): unknown }[] = [];

afterEach(() => {
  while (opened.length > 0) opened.pop()?.stop(true);
});

async function makeApp(): Promise<Application> {
  const router = new Router();
  router.get("/ping", () => new Response("pong"));
  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();
  return app;
}

test("extraPorts serve the same app on more ports and report each one", async () => {
  const app = await makeApp();
  const reported: number[] = [];
  const main = serve(app, {
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    extraPorts: [0],
    onExtraPort: (port) => reported.push(port),
  });
  opened.push(main);

  // Port 0 asks for any free port, so it is reported as 0; real ports are reported as given.
  expect(reported).toEqual([0]);
  const res = await fetch(`http://127.0.0.1:${main.port}/ping`);
  expect(await res.text()).toBe("pong");
});

test("an extra port that is taken is skipped and the main listener keeps working", async () => {
  const app = await makeApp();
  const blocker = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("blocked"),
  });
  opened.push(blocker);
  const reported: number[] = [];

  const main = serve(app, {
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    extraPorts: [blocker.port!],
    onExtraPort: (port) => reported.push(port),
  });
  opened.push(main);

  expect(reported).toEqual([]);
  const res = await fetch(`http://127.0.0.1:${main.port}/ping`);
  expect(await res.text()).toBe("pong");
  // The port that was already taken still belongs to its first owner.
  expect(await (await fetch(`http://127.0.0.1:${blocker.port}/`)).text()).toBe(
    "blocked",
  );
});
