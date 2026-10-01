import { Model } from "@bunyad/orm";

export default class BenchItem extends Model {
  declare name: string;

  static table = "bench_items";
  static timestamps = false;
  static fillable = ["name"] as const;
}
