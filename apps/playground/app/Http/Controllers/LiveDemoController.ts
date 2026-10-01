import type { Request } from "@bunyad/http";
import { csrf_token } from "@bunyad/auth";
import { Live } from "@bunyad/live";
import { Metrics } from "@bunyad/metrics";
import { view } from "@bunyad/view";

async function recordHit(path: string): Promise<void> {
  Metrics.record("request", path, 1).count();
  await Metrics.ingest();
}

export default class LiveDemoController {
  async index(request: Request) {
    await recordHit("/livewire");
    const dashboard = await Live.mount("dashboard");
    return view("livewire/demo", {
      title: "Live",
      token: csrf_token(request),
      dashboard,
      scripts: Live.scripts(),
    });
  }

  async about(request: Request) {
    await recordHit("/livewire/about");
    return view("livewire/about", {
      title: "About Wire",
      token: csrf_token(request),
      scripts: Live.scripts(),
    });
  }
}
