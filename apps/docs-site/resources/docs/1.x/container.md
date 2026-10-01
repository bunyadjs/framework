---
title: Service Container
description: Bind classes, resolve them with constructor injection, and share one instance across a request.
---

# Service Container

## Introduction

The service container is where you register how a class is built and ask for an instance later. `Application` extends the container, so the object returned by `app()` is the container for the current process.

Most of the time you do not call the container yourself. A controller constructor, a route callback with a typed class argument, and a service provider's `register` method are resolved for you. Reach for the container when a class has more than one implementation, or when you want one shared instance instead of a new object on every call.

```ts
import { app } from "@bunyad/core";

const logger = app().make(Logger);
```

## Zero Configuration Resolution

If a class has no constructor dependencies, `make` builds it without a prior `bind`:

```ts
class Report {
  title = "Daily";
}

const report = app().make(Report);

report.title;
```

When the constructor asks for another class, mark the class with `@Injectable()` so the parameter types are available at runtime. Import `Injectable` from `@bunyad/container`. You can also set a static `inject` array of the same classes, in constructor order, and skip the decorator.

```ts
import { Injectable } from "@bunyad/container";
import { app } from "@bunyad/core";
import Logger from "@/Services/Logger.ts";

@Injectable()
class ReportWriter {
  constructor(public logger: Logger) {}
}

app().bind(Logger, Logger);

const writer = app().make(ReportWriter);
```

`make("missing")` throws `BindingResolutionError` when that string was never registered. A class you pass directly is constructed even without a binding. If that class has constructor dependencies, add `@Injectable()` or a static `inject` array so those dependencies are visible. A cycle (A needs B, B needs A) throws `CircularDependencyError`.

## Binding

### Binding Basics

`bind` registers a recipe. Every `make` runs it again:

```ts
import { app } from "@bunyad/core";
import Logger from "@/Services/Logger.ts";
import FileLogger from "@/Services/FileLogger.ts";

app().bind(Logger, FileLogger);

const first = app().make(Logger);
const second = app().make(Logger);
```

`first` and `second` are different objects. Pass a function when construction needs more than `new`:

```ts
app().bind(Logger, () => new FileLogger(app().make(Path)));
```

The function receives the container as its first argument.

`singleton` runs the recipe once and returns that same object afterward:

```ts
app().singleton(Logger, FileLogger);

app().make(Logger) === app().make(Logger);
```

`bindIf` and `singletonIf` register only when that key is not already bound. `scoped` is a singleton that `forgetScopedInstances()` drops, which is useful for state that should not survive the next request in a long-running process. `instance` stores an object you already built:

```ts
const logger = new FileLogger("/var/log/app.log");

app().instance(Logger, logger);
```

`alias` lets a string resolve to a class binding:

```ts
app().singleton(Logger, FileLogger);
app().alias("log", Logger);

app().make<Logger>("log");
```

`bound` reports whether a key or class is registered. `resolved` reports whether it has been built at least once. `isShared` is true for singletons and for values stored with `instance`.

### Binding Interfaces to Implementations

Bind the type your constructors ask for, and point it at the class you want created:

```ts
import { app } from "@bunyad/core";
import EventPusher from "@/Contracts/EventPusher.ts";
import RedisEventPusher from "@/Services/RedisEventPusher.ts";

app().singleton(EventPusher, RedisEventPusher);
```

`EventPusher` must be a class or abstract class. A TypeScript `interface` is erased at runtime, so it cannot be a container key. Use an abstract class, or a string key, when you want that seam.

### Contextual Binding

`when(consumer).needs(dependency).give(implementation)` changes the dependency for one consumer only. Other classes that ask for the same dependency still receive the normal binding.

```ts
import { Injectable } from "@bunyad/container";
import { app } from "@bunyad/core";
import Logger from "@/Services/Logger.ts";
import FileLogger from "@/Services/FileLogger.ts";
import ConsoleLogger from "@/Services/ConsoleLogger.ts";
import ReportService from "@/Services/ReportService.ts";

app().bind(Logger, ConsoleLogger);

app().when(ReportService).needs(Logger).give(FileLogger);
```

`give` accepts a class, a factory, or a ready value. `giveTagged` passes every binding registered under a tag:

```ts
app().when(ReportAggregator).needs(Logger).giveTagged("loggers");
```

### Tagging

Group bindings under a name, then resolve the whole group:

```ts
import { app } from "@bunyad/core";
import DiskReporter from "@/Services/DiskReporter.ts";
import MemoryReporter from "@/Services/MemoryReporter.ts";

app().bind(DiskReporter, DiskReporter);
app().bind(MemoryReporter, MemoryReporter);

app().tag([DiskReporter, MemoryReporter], "reports");

const reports = app().tagged<Reporter>("reports");
```

`tagged` returns an array of resolved instances, in registration order.

### Extending Bindings

`extend` wraps the object after it is built. Use it to decorate a binding from another package without replacing the binding:

```ts
app().extend(Logger, (logger, container) => {
  logger.setClock(container.make(Clock));

  return logger;
});
```

The callback must return the instance (or a replacement). Extenders run for singletons and for auto-wired classes.

## Resolving

### The `make` Method

`make` resolves a class or a string key. The second argument overrides constructor parameters for that one call. Use the dependency's class name as the key. A numeric string (`"0"`, `"1"`) fills that position instead, which is how you pass a primitive the container cannot build:

```ts
const writer = app().make(ReportWriter, {
  Logger: new FileLogger("/tmp/report.log"),
});
```

`makeWith` and `resolve` are aliases of `make`. `factory` returns a function that calls `make` when you invoke it, which is handy when another object wants a builder rather than an instance:

```ts
const makeLogger = app().factory(Logger);

const logger = makeLogger();
```

`forgetInstance` drops one shared instance so the next `make` builds it again. `forgetInstances` drops every shared instance. `flush` clears bindings, aliases, tags, and instances.

### Automatic Injection

Route controllers are built by the container. A controller constructor that type-hints a class receives that class when the route runs. The router reads the constructor from the controller file, so the class does not need `@Injectable()` for that path. Import the dependency with a value import from `@/`, the same way route model binding loads a model class.

Other classes that you pass to `make` yourself need `@Injectable()` or a static `inject` array. Without one of those, a typed constructor parameter is invisible at runtime and the container cannot fill it.

## Method Invocation and Injection

`call` invokes a function or a method and fills arguments the container knows how to build. For a method, pass `[Class, "method"]`:

```ts
import { app } from "@bunyad/core";
import PodcastController from "@/Http/Controllers/PodcastController.ts";

const body = app().call([PodcastController, "show"]);
```

The second argument overrides a typed dependency by class name, the same way `make` does. You can also pass `"PodcastController@show"` after `app().bind(PodcastController)`, because that string form looks the class up by name.

`bindMethod` replaces the normal call for one method. The callback receives the instance and the container:

```ts
app().bindMethod([PodcastController, "show"], (controller, container) => {
  return controller.show(container.make(PodcastRepository));
});
```

`wrap` returns a zero-argument function that runs `call` later.

A closure can declare its own dependencies with an `inject` array on the function:

```ts
function send(logger: Logger) {
  logger.write("sent");
}

send.inject = [Logger];

app().call(send);
```

## Container Events

`resolving` runs after an object is built, before it is returned. Pass a class to listen for that binding, or pass only a callback to listen for every resolution:

```ts
app().resolving(Logger, (logger) => {
  logger.boot();
});

app().resolving((instance) => {
  // every resolution
});
```

`afterResolving` runs after `resolving`. `beforeResolving` runs before the recipe, and its callback receives the abstract key, the parameter map, and the container.

### Rebinding

`rebinding` runs when a shared binding is replaced. The callback receives the container and the new instance:

```ts
app().rebinding(Logger, (container, logger) => {
  container.make(ReportWriter).setLogger(logger);
});
```

`refresh(abstract, target, method)` is the short form: on rebind it calls `target[method](newInstance)`.

## PSR-11

`get` and `has` match the PSR-11 container methods. `has` is `bound`. `get` is `make` and throws `BindingResolutionError` when the id is missing:

```ts
if (app().has("log")) {
  const logger = app().get<Logger>("log");
}
```
