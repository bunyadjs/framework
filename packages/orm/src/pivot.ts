import { Model } from "./model.ts";

/**
 * Intermediate table model (`product_categories`, `model_has_roles`, …).
 * Composite / non-incrementing keys — `create()` inserts without `RETURNING id`.
 */
export class Pivot extends Model {
  static incrementing = false;
  static timestamps = false;
}
