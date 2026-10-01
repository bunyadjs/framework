import { Auth } from "@bunyad/auth";
import type { Request } from "@bunyad/http";
import { json } from "@bunyad/http";
import Note from "../../Models/Note.ts";
import User from "../../Models/User.ts";

function tenantIdOf(user: User): string {
  return user.tenant_id == null || String(user.tenant_id) === ""
    ? "demo"
    : String(user.tenant_id);
}

export default class NoteController {
  async index(request: Request) {
    const user = (await Auth.guard("token").user(request))! as User;
    const notes = await Note.where("tenant_id", tenantIdOf(user))
      .orderBy("created_at")
      .get();
    return json({
      notes: notes.all().map((note) => ({
        id: note.id,
        title: note.title,
        body: note.body ?? null,
        tags: note.tags ?? null,
        user_id: note.user_id,
      })),
    });
  }

  async store(request: Request) {
    const user = (await Auth.guard("token").user(request))! as User;
    const data = await request.validate({
      title: "required|string|min:1",
      body: "nullable|string",
      tags: "nullable|string",
    });
    const note = await Note.create({
      title: String(data.title),
      body: data.body == null ? null : String(data.body),
      tags: data.tags == null || String(data.tags).trim() === ""
        ? null
        : String(data.tags),
      user_id: user.id,
      tenant_id: tenantIdOf(user as User),
    });
    return json(
      {
        id: note.id,
        title: note.title,
        body: note.body ?? null,
        tags: note.tags ?? null,
        user_id: note.user_id,
      },
      201,
    );
  }

  async update(request: Request, note: Note) {
    const user = (await Auth.guard("token").user(request))! as User;
    if (String(note.tenant_id ?? "demo") !== tenantIdOf(user)) {
      return json({ message: "Forbidden." }, 403);
    }
    const data = await request.validate({
      title: "required|string|min:1",
      body: "nullable|string",
      tags: "nullable|string",
    });
    await note.update({
      title: String(data.title),
      body: data.body == null ? null : String(data.body),
      tags:
        data.tags == null || String(data.tags).trim() === ""
          ? null
          : String(data.tags),
    });
    return json({
      id: note.id,
      title: note.title,
      body: note.body ?? null,
      tags: note.tags ?? null,
      user_id: note.user_id,
    });
  }

  async destroy(request: Request, note: Note) {
    const user = (await Auth.guard("token").user(request))! as User;
    if (String(note.tenant_id ?? "demo") !== tenantIdOf(user)) {
      return json({ message: "Forbidden." }, 403);
    }
    await note.delete();
    return json({ deleted: true });
  }
}
