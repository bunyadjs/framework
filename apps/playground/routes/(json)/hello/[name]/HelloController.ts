import type { Request } from "@bunyad/http";
import { Name, json } from "@bunyad/http";

export default class HelloController {
  @Name("hello.show")
  show(request: Request) {
    return json({
      message: `Hello, ${request.route("name")}`,
    });
  }
}
