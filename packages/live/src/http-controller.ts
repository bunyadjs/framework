import type { Request } from "@bunyad/http";
import { json, HttpException } from "@bunyad/http";
import { clientScript } from "./client.ts";
import { updateLive } from "./component.ts";
import type { LiveUpdatePayload, Snapshot } from "./snapshot.ts";

let scriptUpdatePath = "/live/update";

/** Configure the update URL embedded in the client script response. */
export function configureLiveHttp(options: {
  updatePath?: string;
}): void {
  if (options.updatePath) scriptUpdatePath = options.updatePath;
}

/**
 * HTTP actions for Live update + client script.
 * Register via `Live.routes(router)` (uses `[LiveController, method]`).
 */
export default class LiveController {
  async script() {
    return new Response(clientScript(scriptUpdatePath), {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }

  async update(request: Request) {
    await request.loadJson();
    const body = request.all() as Partial<LiveUpdatePayload>;
    if (!body.name || !body.snapshot) {
      throw new HttpException(422, "Invalid Live payload.");
    }
    try {
      const result = await updateLive({
        name: String(body.name),
        snapshot: body.snapshot as Snapshot,
        calls: body.calls,
        updates: body.updates,
        children: body.children,
      });
      return json(result);
    } catch (error) {
      // `abort(401)` / `abort(423)` inside an action keep their status.
      if (error instanceof HttpException) throw error;
      const message =
        error instanceof Error ? error.message : "Live update failed.";
      throw new HttpException(422, message);
    }
  }
}
