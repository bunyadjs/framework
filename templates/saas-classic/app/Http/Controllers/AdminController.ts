import { view } from "@bunyad/view";
import User from "@/Models/User.ts";

export default class AdminController {
  async index() {
    return view("admin.index", {
      title: "Admin",
      userCount: await User.query().count(),
      proCount: await User.where("plan", "pro").count(),
    });
  }
}
