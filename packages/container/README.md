# @bunyad/container

A dependency-injection container with bindings, singletons, aliases, tags, contextual bindings and constructor auto-wiring.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/container@beta
# or: npm install @bunyad/container@beta
```

## Usage

```ts
import { Container, Injectable } from "@bunyad/container";

class Logger {
  write(msg: string) { return msg; }
}
class FileLogger extends Logger {
  write(msg: string) { return `file:${msg}`; }
}

@Injectable()
class Greeter {
  constructor(public logger: Logger) {}
  hello() { return this.logger.write("hi"); }
}

const container = new Container();
container.singleton(Logger, FileLogger);

container.make(Greeter).hello();                 // "file:hi" (constructor auto-wired)
container.make(Logger) === container.make(Logger); // true (singleton)

container.alias("log", Logger);
container.make<Logger>("log") instanceof FileLogger; // true
```

Also available: `bind`, `instance`, `scoped`, `bindIf`/`singletonIf`, `tag`/`tagged`, `when(...).needs(...).give(...)` contextual bindings, and `CircularDependencyError` / `BindingResolutionError`.

## Notes

- Bun only (Bun 1.4 or newer).
- Auto-wiring reads constructor parameter types, so enable `experimentalDecorators` and `emitDecoratorMetadata` and mark classes with `@Injectable()`. Without decorators, declare `static inject = [Logger]` on the class.
- Unbound classes with no dependencies resolve automatically; unbound string keys throw `BindingResolutionError`.
- Depends on `@bunyad/common`.

## License

MIT
