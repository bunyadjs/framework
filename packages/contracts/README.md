# @bunyad/contracts

Shared TypeScript interfaces that let Bunyad packages and your own code swap implementations: cache, queue, session, filesystem and mail contracts, plus HTTP request and response shapes.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/contracts@beta
# or: npm install @bunyad/contracts@beta
```

## Usage

```ts
import { isResponsable, type Mailer, type MailMessage } from "@bunyad/contracts";

// A custom mailer only has to implement send().
class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

const mailer = new MemoryMailer();
await mailer.send({ to: "ada@example.com", subject: "Hi", text: "Hello" });
console.log(mailer.sent.length); // 1

// The one runtime export: does a value know how to turn itself into a Response?
console.log(isResponsable({ toResponse: () => new Response("ok") })); // true
console.log(isResponsable("nope")); // false
```

## Notes

- Not tied to Bun: it is almost entirely types, and its only runtime export is `isResponsable`. It is published as TypeScript source (`engines.node >= 20`).
- Contracts: `CacheStore`, `QueueDriver` / `JobPayload`, `SessionStore`, `Filesystem`, `Mailer` / `MailMessage`, and `RequestContract` / `ResponseFactory` / `Responsable`.
- Implement a contract and register it with the matching package, for example a `QueueDriver` for `@bunyad/queue` or a `CacheStore` for `@bunyad/cache`.

## License

MIT
