import type { Request } from "@bunyad/http";
import { csrf_token } from "@bunyad/auth";
import { Head } from "@bunyad/head";
import { Live } from "@bunyad/live-components";
import User from "@/Models/User.ts";

export default class WelcomeController {
  /** View: `WelcomePage.view`. */
  async show(request: Request) {
    Head.title("Welcome").description("Bunyad welcome page");
    return {
      title: "Welcome",
      token: csrf_token(request),
      status: request.session?.get<string>("status"),
      users: (await User.all()).map((u) => ({ name: u.name, email: u.email })),
      scripts: Live.scripts(),
    };
  }
}
