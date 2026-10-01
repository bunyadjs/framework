import type { Next } from "@bunyad/contracts";
import type { Request } from "@bunyad/http";

/** Example middleware — sets a response header. */
export default class SetHeader {
  handle(_request: Request, next: Next) {
    const out = next();
    if (out instanceof Promise) {
      return out.then((response) => {
        response.headers.set("X-Example", "1");
        return response;
      });
    }
    out.headers.set("X-Example", "1");
    return out;
  }
}
