import { json } from "@bunyad/http";
import { HELLO } from "../../../../shared.ts";

export default class ZeroController {
  handle() {
    return json(HELLO);
  }
}
