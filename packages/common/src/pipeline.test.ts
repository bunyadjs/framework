import { expect, test } from "bun:test";
import { Pipeline, type Pipe } from "../src/pipeline.ts";

test("Pipeline send through then with closures", async () => {
  const result = await Pipeline.send(1)
    .through([
      (n, next) => next(n + 1),
      (n, next) => next(n * 10),
    ])
    .then((n) => n + 5);

  expect(result).toBe(25);
});

test("Pipeline pipe appends and thenReturn", async () => {
  const result = await Pipeline.send("a")
    .through([(s, next) => next(`${s}b`)])
    .pipe((s, next) => next(`${s}c`))
    .thenReturn();

  expect(result).toBe("abc");
});

test("Pipeline object and class pipes via handle", async () => {
  const objectPipe = {
    handle(value: number, next: (n: number) => number | Promise<number>) {
      return next(value + 2);
    },
  };

  class TimesThree {
    handle(value: number, next: (n: number) => number | Promise<number>) {
      return next(value * 3);
    }
  }

  const result = await Pipeline.send(5)
    .through([objectPipe, TimesThree] as Pipe<number>[])
    .thenReturn();

  expect(result).toBe(21);
});

test("Pipeline via custom method name", async () => {
  class Custom {
    process(value: string, next: (s: string) => string | Promise<string>) {
      return next(value.toUpperCase());
    }
  }

  const result = await Pipeline.send("ok")
    .through([Custom] as unknown as Pipe<string>[])
    .via("process")
    .thenReturn();

  expect(result).toBe("OK");
});

test("Pipeline finally runs after destination", async () => {
  const log: string[] = [];
  const result = await Pipeline.send(1)
    .through([(n, next) => next(n + 1)])
    .finally((n) => {
      log.push(`finally:${n}`);
    })
    .then((n) => {
      log.push(`then:${n}`);
      return n * 2;
    });

  expect(result).toBe(4);
  expect(log).toEqual(["then:2", "finally:2"]);
});

test("Pipeline finally runs when destination throws", async () => {
  const log: string[] = [];
  await expect(
    Pipeline.send(1)
      .finally(() => {
        log.push("finally");
      })
      .then(() => {
        throw new Error("boom");
      }),
  ).rejects.toThrow("boom");
  expect(log).toEqual(["finally"]);
});

test("Pipeline when unless pipes", async () => {
  const result = await Pipeline.send(1)
    .when(true, (p) => p.pipe((n, next) => next(n + 1)))
    .unless(false, (p) => p.pipe((n, next) => next(n * 2)))
    .thenReturn();
  expect(result).toBe(4);
  expect(
    Pipeline.send(0)
      .through([(n, next) => next(n)])
      .pipes().length,
  ).toBe(1);
});
