# @bunyad/container

Laravel-like service container for Bun.

```ts
container.singleton(Logger, () => new ConsoleLogger());
const logger = container.make(Logger);
```
