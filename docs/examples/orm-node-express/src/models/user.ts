import { Model } from "@bunyad/orm";

/**
 * Bunyad Model — not a Nest `@Entity()` or Prisma model.
 */
export class User extends Model {
  static table = "users";
  static fillable = ["email", "name"] as const;

  declare id: number;
  declare email: string;
  declare name: string;
  declare created_at?: string;
  declare updated_at?: string;
}
