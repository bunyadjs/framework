import { Get, Post, json } from "@bunyad/http";
import BenchItem from "@/Models/BenchItem.ts";
import { BENCH_HELLO } from "@/Support/bench-routes.ts";

export default class BenchController {
  @Get("/bench/hello", { name: "bench.hello" })
  hello() {
    return json(BENCH_HELLO);
  }

  @Get("/bench/select", { name: "bench.select" })
  select() {
    const item = BenchItem.find(1) as BenchItem;
    return json({ id: Number(item.id), name: item.name });
  }

  @Post("/bench/insert", { name: "bench.insert" })
  insert() {
    const item = BenchItem.create({ name: "hello" }) as BenchItem;
    return json({ id: Number(item.id) });
  }
}
