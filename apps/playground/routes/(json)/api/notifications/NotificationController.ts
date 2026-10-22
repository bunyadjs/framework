import type { Request } from "@bunyad/http";
import { Middleware, Name, Post, json } from "@bunyad/http";
import { Auth, auth } from "@bunyad/auth";
import User from "@/Models/User.ts";

@Middleware("throttle:api", auth({ guard: "token" }))
export default class NotificationController {
  @Name("notifications.index")
  async index(request: Request) {
    const user = (await Auth().user(request))! as User;
    const rows = await user.notifications().get();

    return json({
      data: rows.map((row) => ({
        id: row.id,
        type: row.type,
        data: row.data,
        read_at: row.readAt,
        created_at: row.createdAt,
      })),
      meta: {
        unread: await user.notifications().unreadCount(),
      },
    });
  }

  @Post("/{id}/read", { name: "notifications.read" })
  async markRead(request: Request) {
    const user = (await Auth().user(request))! as User;
    const id = String(request.route("id"));
    const rows = await user.notifications().get();
    const owned = rows.find((r) => r.id === id);
    if (!owned) return json({ message: "Not found." }, 404);

    await user.notifications().markAsRead(id);
    return json({ ok: true });
  }
}
