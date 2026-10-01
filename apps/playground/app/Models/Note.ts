import { HasUuids, Model } from "@bunyad/orm";

@HasUuids()
export default class Note extends Model {
  declare title: string;
  declare body?: string | null;
  declare user_id: string | number;
  declare tenant_id: string;
  declare tags?: string | null;

  static table = "notes";
  static fillable = ["title", "body", "user_id", "tenant_id", "tags"] as const;
}
