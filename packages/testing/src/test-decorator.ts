import { test as bunTest } from "bun:test";
import { TestCase } from "./test-case.ts";

/** Registers the method with Bun's test runner. */
export function test(name?: string): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const method = descriptor?.value;
    if (typeof method !== "function") {
      throw new Error("@test() can only decorate methods.");
    }

    const ctor = target.constructor as new () => unknown;
    const className = ctor.name || "TestCase";
    const methodName = name ?? String(propertyKey);
    const title = `${className} ${methodName}`;

    bunTest(title, async () => {
      const instance = new ctor();
      if (instance instanceof TestCase) {
        await instance.bootClient();
      }
      const hooks = instance as {
        setUp?: () => void | Promise<void>;
        tearDown?: () => void | Promise<void>;
      };
      if (hooks.setUp) await hooks.setUp.call(instance);
      try {
        await method.call(instance);
      } finally {
        if (hooks.tearDown) await hooks.tearDown.call(instance);
      }
    });
  };
}
