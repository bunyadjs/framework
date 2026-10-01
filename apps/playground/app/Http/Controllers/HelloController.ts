import type { Request } from "@bunyad/http";
import { csrf_token } from "@bunyad/auth";
import { json } from "@bunyad/http";
import { Live } from "@bunyad/live";
import { view } from "@bunyad/view";

export default class HelloController {
  async index(request: Request) {
    if (request.wantsJson()) {
      return json({
        message: "Hello, Bunyad",
        framework: "bunyad",
      });
    }

    return view("home", {
      title: "Bunyad Playground",
      token: csrf_token(request),
      scripts: Live.scripts(),
    });
  }

  show(request: Request) {
    return json({
      message: `Hello, ${request.route("name")}`,
    });
  }
}
