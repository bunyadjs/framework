import type { Request } from "@bunyad/http";
import { csrf_token } from "@bunyad/auth";
import { Get, json } from "@bunyad/http";
import { Live } from "@bunyad/live-components";

export default class HelloController {
  /** View: `HomePage.view`. */
  @Get("/", { name: "home" })
  async home(request: Request) {
    if (request.wantsJson()) {
      return json({
        message: "Hello, Bunyad",
        framework: "bunyad",
      });
    }

    return {
      title: "Bunyad Playground",
      token: csrf_token(request),
      scripts: Live.scripts(),
    };
  }
}
