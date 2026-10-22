import { json, type Request } from "@bunyad/http";

export default class UserController {
  show(request: Request) {
    return json({ id: request.route("id") });
  }
}
