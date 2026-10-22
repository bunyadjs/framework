import type { Request } from "@bunyad/http";
import { Auth } from "@bunyad/auth";

export default class DashboardController {
  /** Props of `DashboardPage.tsx`. */
  async show(request: Request) {
    const user = await Auth().user(request);
    return { name: String(user!.name ?? user!.email) };
  }
}
