import type { Request } from "@bunyad/http";
import { csrf_token } from "@bunyad/auth";
import { view } from "@bunyad/view";
import { Head } from "@bunyad/head";
import { Live } from "@bunyad/live";
import User from "../../Models/User.ts";

const CONNECTIONS = [
  { name: "default", label: "Default (primary)" },
  { name: "secondary", label: "Secondary" },
] as const;

export default class DatabaseDemoController {
  async index(request: Request) {
    const requested = String(request.input("connection") ?? "default");
    const connection =
      requested === "secondary" ? "secondary" : ("default" as const);

    const rows =
      connection === "secondary"
        ? await User.on("secondary").orderBy("id").get()
        : await User.orderBy("id").get();

    Head.title("Databases").description("Multiple database connections demo");

    return view("databases", {
      title: "Multiple databases",
      token: csrf_token(request),
      connection,
      connections: CONNECTIONS.map((c) => ({
        ...c,
        active: c.name === connection,
      })),
      users: rows.map((u) => ({ name: u.name, email: u.email })),
      scripts: Live.scripts(),
    });
  }
}
