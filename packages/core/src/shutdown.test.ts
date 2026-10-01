import { expect, test, beforeEach, afterEach } from "bun:test";
import {
  installShutdownHandlers,
  onShutdown,
  requestShutdown,
  resetShutdownForTests,
  shutdownSignal,
} from "../src/shutdown.ts";

beforeEach(() => {
  resetShutdownForTests();
});

afterEach(() => {
  resetShutdownForTests();
});

test("shutdownSignal aborts via requestShutdown", async () => {
  const signal = shutdownSignal();
  expect(signal.aborted).toBe(false);
  let called = false;
  onShutdown(() => {
    called = true;
  });
  requestShutdown("test");
  expect(signal.aborted).toBe(true);
  await Bun.sleep(1);
  expect(called).toBe(true);
});

test("installShutdownHandlers is idempotent", () => {
  const a = installShutdownHandlers();
  const b = installShutdownHandlers();
  expect(a).toBe(b);
  expect(a.aborted).toBe(false);
});
