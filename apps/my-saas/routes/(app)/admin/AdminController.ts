import { Middleware, Name } from "@bunyad/http";
import User from "@/Models/User.ts";

export default class AdminController {
  @Name("admin")
  @Middleware("auth", "can:admin")
  async index() {
    return {
      userCount: await User.query().count(),
      proCount: await User.where("plan", "pro").count(),
    };
  }
}
