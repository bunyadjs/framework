import type { Request } from "@bunyad/http";
import { Name } from "@bunyad/http";
import { csrf_token } from "@bunyad/auth";
import { Live } from "@bunyad/live-components";
import { Metrics } from "@bunyad/metrics";

async function recordHit(path: string): Promise<void> {
  Metrics.record("request", path, 1).count();
  await Metrics.ingest();
}

export default class LiveDemoController {
  /** View: `LivewirePage.view`. */
  @Name("wire")
  async show(request: Request) {
    await recordHit("/livewire");
    const dashboard = await Live.mount("dashboard");
    return {
      title: "Live",
      token: csrf_token(request),
      dashboard,
      scripts: Live.scripts(),
    };
  }
}
