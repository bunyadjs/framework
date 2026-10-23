import { json } from "@bunyad/http";
import { HELLO } from "../../../shared.ts";

export default class HelloController {
  handle() {
    return json(HELLO);
  }
}
