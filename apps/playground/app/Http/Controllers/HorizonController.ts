import type { Request } from "@bunyad/http";
import { json, redirect } from "@bunyad/http";
import { Auth, csrf_token, Gate } from "@bunyad/auth";
import { Queue } from "@bunyad/queue";
import { view } from "@bunyad/view";

async function ensureAdmin(request: Request): Promise<Response | null> {
  if (!(await Auth().check(request)) || !(await Gate.allows(request, "admin"))) {
    const accept = request.header("accept") ?? "";
    if (accept.includes("text/html")) return redirect("/login");
    return json({ message: "Forbidden" }, 403);
  }
  return null;
}

/**
 * Horizon-lite queue dashboard (admin only).
 */
export default class HorizonController {
  async index(request: Request) {
    const denied = await ensureAdmin(request);
    if (denied) return denied;
    return view("horizon.index", {
      title: "Horizon",
      token: csrf_token(request),
    });
  }

  async stats(request: Request) {
    const denied = await ensureAdmin(request);
    if (denied) return denied;
    const name = String(request.input("queue") ?? "default");
    const pending = await Queue.size(name);
    const failed = Queue.failed ? await Queue.failed.all() : [];
    return json({
      queue: name,
      pending,
      failed: failed.map((job) => ({
        id: job.id,
        name: job.payload.name,
        queue: job.queue,
        exception: job.exception.split("\n")[0],
        failed_at: job.failedAt,
      })),
    });
  }

  async retry(request: Request) {
    const denied = await ensureAdmin(request);
    if (denied) return denied;
    const id = String(request.route("id"));
    const ok = await Queue.retry(id);
    return ok
      ? json({ ok: true })
      : json({ message: "Failed job not found." }, 404);
  }

  async retryAll(request: Request) {
    const denied = await ensureAdmin(request);
    if (denied) return denied;
    const n = await Queue.retryAll();
    return json({ retried: n });
  }
}
