import { expect, test } from "bun:test";
import { Collection } from "./collection.ts";
import { LazyCollection } from "./lazy-collection.ts";

/** A source that records how many items were pulled and whether it was released. */
function tracked(total = 100) {
  const state = { pulled: 0, released: false, started: 0 };
  const source = new LazyCollection<number>(async function* () {
    state.started++;
    try {
      for (let i = 1; i <= total; i++) {
        state.pulled++;
        yield i;
      }
    } finally {
      state.released = true;
    }
  });
  return { source, state };
}

test("map / filter / take run lazily and in order", async () => {
  const { source, state } = tracked();
  const out = await source
    .filter((n) => n % 2 === 0)
    .map((n) => n * 10)
    .take(3)
    .toArray();
  expect(out).toEqual([20, 40, 60]);
  // 6 items were needed to find 3 evens; the rest were never pulled.
  expect(state.pulled).toBe(6);
  expect(state.released).toBe(true);
});

test("nothing runs until a terminal method is called", async () => {
  const { source, state } = tracked();
  source.map((n) => n + 1).filter(Boolean).take(2);
  expect(state.started).toBe(0);
  await source.take(1).toArray();
  expect(state.started).toBe(1);
});

test("async callbacks are awaited", async () => {
  const out = await LazyCollection.make([1, 2, 3, 4])
    .map(async (n) => n * 2)
    .filter(async (n) => n > 2)
    .toArray();
  expect(out).toEqual([4, 6, 8]);
});

test("first / each(false) / take(0) stop pulling and release the source", async () => {
  let t = tracked();
  expect(await t.source.first((n) => n === 4)).toBe(4);
  expect(t.state.pulled).toBe(4);
  expect(t.state.released).toBe(true);

  t = tracked();
  const seen: number[] = [];
  await t.source.each((n) => {
    seen.push(n);
    if (n === 3) return false;
  });
  expect(seen).toEqual([1, 2, 3]);
  expect(t.state.pulled).toBe(3);
  expect(t.state.released).toBe(true);

  t = tracked();
  expect(await t.source.take(0).toArray()).toEqual([]);
  expect(t.state.pulled).toBe(0);
});

test("skip / takeWhile / takeUntil / skipWhile / reject / tap", async () => {
  const nums = () => LazyCollection.make([1, 2, 3, 4, 5, 6]);
  expect(await nums().skip(2).toArray()).toEqual([3, 4, 5, 6]);
  expect(await nums().takeWhile((n) => n < 4).toArray()).toEqual([1, 2, 3]);
  expect(await nums().takeUntil((n) => n === 3).toArray()).toEqual([1, 2]);
  expect(await nums().skipWhile((n) => n < 4).toArray()).toEqual([4, 5, 6]);
  expect(await nums().reject((n) => n % 2 === 0).toArray()).toEqual([1, 3, 5]);
  const tapped: number[] = [];
  await nums().tap((n) => void tapped.push(n)).take(2).toArray();
  expect(tapped).toEqual([1, 2]);
});

test("chunk yields Collections and flushes the remainder", async () => {
  const chunks = await LazyCollection.make([1, 2, 3, 4, 5]).chunk(2).toArray();
  expect(chunks.every((c) => c instanceof Collection)).toBe(true);
  expect(chunks.map((c) => c.all())).toEqual([[1, 2], [3, 4], [5]]);
});

test("pluck / unique / flatMap on rows", async () => {
  const rows = [
    { id: 1, tag: "a", items: [1, 2] },
    { id: 2, tag: "b", items: [3] },
    { id: 3, tag: "a", items: [] },
  ];
  const lazy = () => LazyCollection.make(rows);
  expect(await lazy().pluck("id").toArray()).toEqual([1, 2, 3]);
  expect((await lazy().unique("tag").toArray()).map((r) => r.id)).toEqual([1, 2]);
  expect(await lazy().flatMap((r) => r.items).toArray()).toEqual([1, 2, 3]);
});

test("terminal aggregates", async () => {
  const rows = () => LazyCollection.make([{ n: 2 }, { n: 4 }, { n: 9 }]);
  expect(await rows().count()).toBe(3);
  expect(await rows().sum("n")).toBe(15);
  expect(await rows().avg("n")).toBe(5);
  expect(await rows().min("n")).toBe(2);
  expect(await rows().max("n")).toBe(9);
  expect(await rows().reduce((c, r) => c + r.n, 0)).toBe(15);
  expect(await rows().contains((r) => r.n === 4)).toBe(true);
  expect(await rows().every((r) => r.n > 1)).toBe(true);
  expect(await rows().last()).toEqual({ n: 9 });
  expect(await rows().isEmpty()).toBe(false);
  expect(await LazyCollection.make<number>([]).isEmpty()).toBe(true);
  expect(await LazyCollection.make<number>([]).avg()).toBeNull();
  expect(await LazyCollection.make<number>([]).first()).toBeNull();
});

test("collect() loads into an eager Collection", async () => {
  const eager = await LazyCollection.make([3, 1, 2]).map((n) => n * 2).collect();
  expect(eager).toBeInstanceOf(Collection);
  expect(eager.all()).toEqual([6, 2, 4]);
});

test("iterating twice re-runs the source factory", async () => {
  const { source, state } = tracked(3);
  expect(await source.toArray()).toEqual([1, 2, 3]);
  expect(await source.toArray()).toEqual([1, 2, 3]);
  expect(state.started).toBe(2);
});

test("works with for await and plain iterables", async () => {
  const seen: number[] = [];
  for await (const n of LazyCollection.make(new Set([1, 2, 3]))) seen.push(n);
  expect(seen).toEqual([1, 2, 3]);
});
