import { LiveComponent } from "@bunyad/live";
import Note from "../Models/Note.ts";

type NoteRow = {
  id: string;
  title: string;
  body: string;
  tags: string[];
};

function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,#]/)) {
    const tag = part.trim().toLowerCase().replace(/^#+/, "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function tagsFromNote(raw: unknown): string[] {
  if (raw == null || String(raw).trim() === "") return [];
  return parseTags(String(raw));
}

function ownerKey(userId: string): string | number {
  return /^\d+$/.test(userId) ? Number(userId) : userId;
}

export default class Notes extends LiveComponent {
  userId = "";
  tenantId = "demo";
  title = "";
  body = "";
  tags = "";
  editingId: string | null = null;
  status = "";
  notes: NoteRow[] = [];

  async mount(props: Record<string, unknown> = {}): Promise<void> {
    if (props.userId != null) this.userId = String(props.userId);
    if (props.tenantId != null) this.tenantId = String(props.tenantId);
    await this.reload();
  }

  async boot(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    if (!this.tenantId) {
      this.notes = [];
      return;
    }
    const rows = await Note.where("tenant_id", this.tenantId)
      .orderBy("created_at", "desc")
      .get();
    this.notes = rows.all().map((note) => ({
      id: String(note.id),
      title: String(note.title ?? ""),
      body: note.body == null ? "" : String(note.body),
      tags: tagsFromNote(note.tags),
    }));
  }


  async save(): Promise<void> {
    const title = this.title.trim();
    if (!title) {
      this.status = "Title is required.";
      return;
    }
    const payload = {
      title,
      body: this.body.trim() === "" ? null : this.body.trim(),
      tags: parseTags(this.tags).join(",") || null,
      user_id: ownerKey(this.userId),
      tenant_id: this.tenantId,
    };
    if (this.editingId) {
      const note = await Note.find(this.editingId);
      if (!note || String(note.tenant_id ?? "") !== this.tenantId) {
        this.status = "Note not found.";
        return;
      }
      await note.update({
        title: payload.title,
        body: payload.body,
        tags: payload.tags,
      });
      this.status = "Note updated.";
    } else {
      await Note.create(payload);
      this.status = "Note created.";
    }
    this.title = "";
    this.body = "";
    this.tags = "";
    this.editingId = null;
    await this.reload();
  }

  async edit(id: string): Promise<void> {
    const note = this.notes.find((row) => row.id === id);
    if (!note) return;
    this.editingId = note.id;
    this.title = note.title;
    this.body = note.body;
    this.tags = note.tags.join(", ");
    this.status = "";
  }

  cancel(): void {
    this.editingId = null;
    this.title = "";
    this.body = "";
    this.tags = "";
    this.status = "";
  }

  async remove(id: string): Promise<void> {
    const note = await Note.find(id);
    if (!note || String(note.tenant_id ?? "") !== this.tenantId) {
      this.status = "Note not found.";
      return;
    }
    await note.delete();
    if (this.editingId === id) this.cancel();
    this.status = "Note deleted.";
    await this.reload();
  }

  view(): string {
    return "livewire.notes";
  }
}
