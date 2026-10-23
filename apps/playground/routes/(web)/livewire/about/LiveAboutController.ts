import type { Request } from "@bunyad/http";
import { csrf_token } from "@bunyad/auth";
import { Live } from "@bunyad/live-components";
import { Metrics } from "@bunyad/metrics";

async function recordHit(path: string): Promise<void> {
  Metrics.record("request", path, 1).count();
  await Metrics.ingest();
}

export default class LiveAboutController {
  /** View: `AboutPage.view`. */
  async show(request: Request) {
    await recordHit("/livewire/about");
    return {
      title: "About Wire",
      token: csrf_token(request),
      scripts: Live.scripts(),
    };
  }
}
