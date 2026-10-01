import { Auth, csrf_token } from "@bunyad/auth";
import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Live } from "@bunyad/live";
import { Head } from "@bunyad/head";
import { view } from "@bunyad/view";
import User from "../../Models/User.ts";

export default class NotesPageController {
  async index(request: Request) {
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
    return view("notes", {
      title: "Notes",
      token: csrf_token(request),
      board,
      scripts: Live.scripts(),
      tenantId,
    });
  }
}
