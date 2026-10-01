import type { TestClientOptions } from "./test-client.ts";

export type TestCaseOptions = TestClientOptions & {
  /** Runs before `TestClient.create` (env vars, drivers, etc.). */
  beforeBoot?: () => void | Promise<void>;
};

const configs = new WeakMap<object, TestCaseOptions>();

export function setTestCaseConfig(
  target: object,
  options: TestCaseOptions,
): void {
  configs.set(target, options);
}

export function getTestCaseConfig(
  target: object,
): TestCaseOptions | undefined {
  return configs.get(target);
}

/** TestCase wiring — boot app + optional refreshDatabase. */
export function testCase(options: TestCaseOptions): ClassDecorator {
  return (target) => {
    setTestCaseConfig(target, options);
  };
}
