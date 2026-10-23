import { Auth, csrf_token } from "@bunyad/auth";
import type { Request } from "@bunyad/http";
import { Get, Name, redirect } from "@bunyad/http";
import { Live } from "@bunyad/live-components";
import { Head } from "@bunyad/head";
import BroadcastingController from "../../(json)/api/broadcasting/BroadcastingController.ts";
import User from "@/Models/User.ts";

export default class NotesPageController {
  /** View: `NotesPage.view`. */
  @Name("notes.page")
  async show(request: Request) {
    const user = (await Auth().user(request)) as User | null;
    if (!user) return redirect("/login");

    Head.title("Notes").description("Playground notes");
    const tenantId =
      user.tenant_id == null || String(user.tenant_id) === ""
        ? "demo"
        : String(user.tenant_id);
    const board = await Live.mount("notes", {
      userId: String(user.id),
      tenantId,
    });
    return {
      title: "Notes",
      token: csrf_token(request),
      board,
      scripts: Live.scripts(),
      tenantId,
    };
  }

  /** The same event stream as `/api/broadcasting/sse`, for the signed-in page. */
  @Get("/sync-events", { name: "notes.sync-events" })
  syncEvents(request: Request) {
    return new BroadcastingController().sse(request);
  }
}
