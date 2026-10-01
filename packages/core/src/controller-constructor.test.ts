import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Router } from "@bunyad/router";
import {
  Application,
  createFetchHandler,
  resetControllerConstructorInjectCache,
  stampControllerConstructorInject,
} from "./index.ts";

test("kernel injects constructor type-hints without Injectable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-ctor-"));
  try {
    const controllers = join(dir, "app/Http/Controllers");
    const services = join(dir, "app/Services");
    await mkdir(controllers, { recursive: true });
    await mkdir(services, { recursive: true });

    const clockFile = join(services, "Clock.ts");
    await writeFile(
      clockFile,
      `export class Clock {
  now() {
    return "tock";
  }
}
`,
    );

    const controllerFile = join(controllers, "HintedController.ts");
    await writeFile(
      controllerFile,
      `import { Clock } from "../../Services/Clock.ts";

export default class HintedController {
  constructor(private $clock: Clock) {}

  index() {
    return { now: this.$clock.now() };
  }
}
`,
    );

    const clockMod = (await import(pathToFileURL(clockFile).href)) as {
      Clock: new () => { now(): string };
    };
    const controllerMod = (await import(pathToFileURL(controllerFile).href)) as {
      default: new (...args: any[]) => {
        index: () => { now: string };
      };
    };
    const HintedController = controllerMod.default;
    resetControllerConstructorInjectCache(HintedController);

    const router = new Router();
    router.get("/hinted", [HintedController, "index"]);
    const app = new Application({
      basePath: dir,
      router,
      config: { app: { port: 0 } },
    });
    app.singleton(clockMod.Clock);
    await app.boot();

    stampControllerConstructorInject(HintedController, app);
    expect(
      (HintedController as { inject?: Function[] }).inject,
    ).toEqual([clockMod.Clock]);

    const fetch = createFetchHandler(app);
    const res = await fetch(new Request("http://localhost/hinted"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ now: "tock" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
