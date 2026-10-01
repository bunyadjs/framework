import { json } from "@bunyad/http";
import BenchItem from "../../Models/BenchItem.ts";
import { BENCH_HELLO } from "../../Support/bench-routes.ts";

export default class BenchController {
  hello() {
    return json(BENCH_HELLO);
  }

  select() {
    const item = BenchItem.find(1) as BenchItem;
    return json({ id: Number(item.id), name: item.name });
  }

  insert() {
    const item = BenchItem.create({ name: "hello" }) as BenchItem;
    return json({ id: Number(item.id) });
  }
}
