import { expect, test } from "bun:test";
import {
  BindingResolutionError,
  CircularDependencyError,
  Container,
  Injectable,
} from "../src/index.ts";

class Logger {
  write(msg: string) {
    return msg;
  }
}

class ConsoleLogger extends Logger {
  write(msg: string) {
    return `console:${msg}`;
  }
}

class FileLogger extends Logger {
  write(msg: string) {
    return `file:${msg}`;
  }
}

test("bind returns new instance each make", () => {
  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  const a = c.make(Logger);
  const b = c.make(Logger);
  expect(a).toBeInstanceOf(ConsoleLogger);
  expect(a).not.toBe(b);
});

test("singleton returns same instance", () => {
  const c = new Container();
  c.singleton(Logger, ConsoleLogger);
  expect(c.make(Logger)).toBe(c.make(Logger));
});

test("instance binds existing value", () => {
  const c = new Container();
  const logger = new ConsoleLogger();
  c.instance(Logger, logger);
  expect(c.make(Logger)).toBe(logger);
});

test("alias resolves to abstract", () => {
  const c = new Container();
  c.singleton(Logger, ConsoleLogger);
  c.alias("log", Logger);
  expect(c.make<Logger>("log")).toBeInstanceOf(ConsoleLogger);
});

test("factory concrete receives container", () => {
  const c = new Container();
  c.singleton(Logger, () => new ConsoleLogger());
  expect(c.make(Logger).write("x")).toBe("console:x");
});

test("missing binding throws for string keys", () => {
  const c = new Container();
  expect(() => c.make("missing")).toThrow(BindingResolutionError);
});

test("bound reports registration", () => {
  const c = new Container();
  expect(c.bound("x")).toBe(false);
  c.bind("x", () => 1);
  expect(c.bound("x")).toBe(true);
});

test("constructor injection via Injectable metadata", () => {
  @Injectable()
  class Greeter {
    constructor(public logger: Logger) {}
    hello() {
      return this.logger.write("hi");
    }
  }

  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  const greeter = c.make(Greeter);
  expect(greeter.hello()).toBe("console:hi");
  expect(greeter.logger).toBeInstanceOf(ConsoleLogger);
});

test("static inject array without decorator", () => {
  class Greeter {
    static inject = [Logger];
    constructor(public logger: Logger) {}
  }

  const c = new Container();
  c.bind(Logger, FileLogger);
  expect(c.make(Greeter).logger.write("x")).toBe("file:x");
});

test("auto-wire unbound concrete with no deps", () => {
  class Standalone {
    ok = true;
  }
  const c = new Container();
  expect(c.make(Standalone).ok).toBe(true);
});

test("contextual binding when needs give", () => {
  @Injectable()
  class ReportService {
    constructor(public logger: Logger) {}
  }

  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  c.when(ReportService).needs(Logger).give(FileLogger);

  expect(c.make(ReportService).logger).toBeInstanceOf(FileLogger);
  // other consumers still get default
  @Injectable()
  class Other {
    constructor(public logger: Logger) {}
  }
  expect(c.make(Other).logger).toBeInstanceOf(ConsoleLogger);
});

test("tag and tagged", () => {
  class CpuReport {
    name = "cpu";
  }
  class MemoryReport {
    name = "memory";
  }

  const c = new Container();
  c.bind(CpuReport);
  c.bind(MemoryReport);
  c.tag([CpuReport, MemoryReport], "reports");

  const reports = c.tagged<{ name: string }>("reports");
  expect(reports.map((r) => r.name).sort()).toEqual(["cpu", "memory"]);
});

test("giveTagged contextual", () => {
  class Report {
    constructor(public name: string) {}
  }
  class CpuReport extends Report {
    constructor() {
      super("cpu");
    }
  }
  class MemoryReport extends Report {
    constructor() {
      super("memory");
    }
  }

  @Injectable()
  class Aggregator {
    constructor(public reports: Report[]) {}
  }

  const c = new Container();
  c.bind(CpuReport);
  c.bind(MemoryReport);
  c.tag([CpuReport, MemoryReport], "reports");
  c.when(Aggregator).needs(Array).giveTagged("reports");

  // design:paramtypes for Report[] is often Array
  const agg = c.make(Aggregator);
  expect(agg.reports).toHaveLength(2);
});

test("circular dependency detected", () => {
  const c = new Container();
  c.bind("left", (container) => container.make("right"));
  c.bind("right", (container) => container.make("left"));
  expect(() => c.make("left")).toThrow(CircularDependencyError);
});

test("resolve is alias of make", () => {
  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  expect(c.resolve(Logger)).toBeInstanceOf(ConsoleLogger);
});

test("bindIf and singletonIf only when unbound", () => {
  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  c.bindIf(Logger, FileLogger);
  expect(c.make(Logger)).toBeInstanceOf(ConsoleLogger);

  c.singletonIf("once", () => ({ n: 1 }));
  c.singletonIf("once", () => ({ n: 2 }));
  expect(c.make<{ n: number }>("once").n).toBe(1);
});

test("scoped shared until forgetScopedInstances", () => {
  const c = new Container();
  let n = 0;
  c.scoped("counter", () => ({ n: ++n }));
  expect(c.make<{ n: number }>("counter").n).toBe(1);
  expect(c.make<{ n: number }>("counter").n).toBe(1);
  c.forgetScopedInstances();
  expect(c.make<{ n: number }>("counter").n).toBe(2);
});

test("scopedIf only when unbound", () => {
  const c = new Container();
  c.scoped("s", () => 1);
  c.scopedIf("s", () => 2);
  expect(c.make<number>("s")).toBe(1);
});

test("extend decorates resolved instances", () => {
  const c = new Container();
  c.singleton(Logger, ConsoleLogger);
  c.extend(Logger, (logger) => {
    const base = logger as Logger;
    return {
      write: (msg: string) => `extended:${base.write(msg)}`,
    };
  });
  expect(c.make<Logger>(Logger).write("x")).toBe("extended:console:x");
  expect(c.getExtenders(Logger)).toHaveLength(1);
  c.forgetExtenders(Logger);
  expect(c.getExtenders(Logger)).toHaveLength(0);
});

test("makeWith passes parameter overrides", () => {
  class Service {
    static inject = [Logger];
    constructor(
      public logger: Logger,
      public id?: number,
    ) {}
  }

  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  const s = c.makeWith(Service, { Logger: new FileLogger(), "1": 42 });
  expect(s.logger).toBeInstanceOf(FileLogger);
  expect(s.id).toBe(42);
});

test("factory and wrap", () => {
  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  const factory = c.factory(Logger);
  expect(factory()).toBeInstanceOf(ConsoleLogger);
  expect(factory()).not.toBe(factory());

  const wrapped = c.wrap(() => "ok");
  expect(wrapped()).toBe("ok");
});

test("call injects dependencies into closures", () => {
  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  const fn = Object.assign(
    (logger: Logger) => logger.write("hi"),
    { inject: [Logger] },
  ) as unknown as (...args: unknown[]) => unknown;
  expect(c.call(fn)).toBe("console:hi");
});

test("bindMethod and hasMethodBinding", () => {
  class Controller {
    handle() {
      return "default";
    }
  }

  const c = new Container();
  c.bindMethod([Controller, "handle"], () => "bound");
  expect(c.hasMethodBinding("Controller@handle")).toBe(true);
  expect(c.call([Controller, "handle"])).toBe("bound");
});

test("resolving / afterResolving / beforeResolving hooks", () => {
  const c = new Container();
  const order: string[] = [];
  c.beforeResolving(Logger, () => order.push("before"));
  c.resolving(Logger, () => order.push("resolving"));
  c.afterResolving(Logger, () => order.push("after"));
  c.bind(Logger, ConsoleLogger);
  c.make(Logger);
  expect(order).toEqual(["before", "resolving", "after"]);
});

test("rebinding and refresh", () => {
  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  c.make(Logger);

  const seen: string[] = [];
  c.rebinding(Logger, (_app, instance) => {
    seen.push((instance as Logger).write("x"));
  });

  c.bind(Logger, FileLogger);
  expect(seen).toEqual(["file:x"]);

  const target = {
    logger: null as Logger | null,
    setLogger(logger: Logger) {
      this.logger = logger;
    },
  };
  c.refresh(Logger, target, "setLogger");
  c.bind(Logger, ConsoleLogger);
  expect(target.logger).toBeInstanceOf(ConsoleLogger);
});

test("flush / forgetInstance / forgetInstances / dropStaleInstances", () => {
  const c = new Container();
  c.singleton(Logger, ConsoleLogger);
  c.make(Logger);
  expect(c.resolved(Logger)).toBe(true);

  c.forgetInstance(Logger);
  expect(c.resolved(Logger)).toBe(false);

  c.make(Logger);
  c.forgetInstances();
  expect(c.resolved(Logger)).toBe(false);

  c.alias("log", Logger);
  c.dropStaleInstances("log");
  expect(c.isAlias("log")).toBe(false);

  c.flush();
  expect(c.bound(Logger)).toBe(false);
});

test("get / has / isShared / getAlias / getBindings / build", () => {
  const c = new Container();
  c.singleton(Logger, ConsoleLogger);
  c.alias("log", Logger);

  expect(c.has("log")).toBe(true);
  expect(c.get<Logger>("log")).toBeInstanceOf(ConsoleLogger);
  expect(c.isShared(Logger)).toBe(true);
  expect(c.getAlias("log")).toBe("Logger");
  expect(Object.keys(c.getBindings())).toContain("Logger");
  expect(c.build(ConsoleLogger)).toBeInstanceOf(ConsoleLogger);
});

test("currentlyResolving tracks build stack", () => {
  const c = new Container();
  let during: string | null = null;
  c.bind("outer", (container) => {
    during = container.currentlyResolving();
    return 1;
  });
  c.make("outer");
  // TS can't see that the c.bind callback ran synchronously inside
  // c.make(), so it narrows `during` here to just its initial `null` —
  // reassert the declared type.
  expect(during as string | null).toBe("outer");
  expect(c.currentlyResolving()).toBeNull();
});

test("addContextualBinding registers contextual give", () => {
  @Injectable()
  class ReportService {
    constructor(public logger: Logger) {}
  }

  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  c.addContextualBinding(ReportService, Logger, FileLogger);
  expect(c.make(ReportService).logger).toBeInstanceOf(FileLogger);
});

test("getInstance and setInstance", () => {
  const prev = Container.getInstance();
  const c = new Container();
  Container.setInstance(c);
  expect(Container.getInstance()).toBe(c);
  Container.setInstance(prev);
});

test("call injects method dependencies via inject array", () => {
  class Greeter {
    greet(logger: Logger) {
      return logger.write("hi");
    }
  }
  Object.assign(Greeter.prototype.greet, { inject: [Logger] });

  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  expect(c.call([Greeter, "greet"])).toBe("console:hi");
});

test("call method parameters override injected deps", () => {
  class Greeter {
    greet(logger: Logger) {
      return logger.write("x");
    }
  }
  Object.assign(Greeter.prototype.greet, { inject: [Logger] });

  const c = new Container();
  c.bind(Logger, ConsoleLogger);
  expect(c.call([Greeter, "greet"], { Logger: new FileLogger() })).toBe(
    "file:x",
  );
});

test("call Class@method string form injects method deps", () => {
  class Worker {
    run(logger: Logger) {
      return logger.write("job");
    }
  }
  Object.assign(Worker.prototype.run, { inject: [Logger] });

  const c = new Container();
  c.bind(Worker);
  c.bind(Logger, FileLogger);
  expect(c.call("Worker@run")).toBe("file:job");
});

test("Reflect.decorate applies property decorators without a method descriptor", () => {
  const seen: string[] = [];
  function Mark(): PropertyDecorator {
    return (_target, key) => {
      seen.push(String(key));
    };
  }
  class Sample {
    @Mark()
    id = 1;
  }
  expect(seen).toContain("id");
  expect(new Sample().id).toBe(1);
});
