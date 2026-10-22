import { json } from "@bunyad/http";
import { HELLO } from "../../../../shared.ts";

export default class OneController {
  handle() {
    return json(HELLO);
  }
}
