# @bunyad/queue

Background jobs for Bunyad: delayed dispatch, retries with backoff, chains, batches, job middleware and failed-job storage, over sync, memory, database or Redis drivers.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/queue@beta
# or: npm install @bunyad/queue@beta
```

## Usage

```ts
import { Job, QueueManager, Bus, Queue, dispatch, setQueue, MemoryFailedJobRepository } from "@bunyad/queue";

class SendReceipt extends Job {
  tries = 3;
  backoff = [10, 60]; // seconds between retries
  constructor(public orderId: number) { super(); }
  handle() { console.log(`receipt for order ${this.orderId}`); }
}

const queue = new QueueManager({ connection: "memory", failed: new MemoryFailedJobRepository() });
setQueue(queue);

await dispatch(new SendReceipt(1));
console.log(await queue.size()); // 1 (waiting for a worker)
await queue.work();              // logs "receipt for order 1"

// A chain runs its jobs in order; each is pushed after the previous succeeds.
await Bus.chain([new SendReceipt(2), new SendReceipt(3)]).dispatch();
await queue.work("default", 2);  // logs orders 2 then 3

// In tests, record jobs instead of running them.
const fake = Queue.fake();
await dispatch(new SendReceipt(4));
Queue.assertPushed(SendReceipt, (p) => (p.data as SendReceipt).orderId === 4);
Queue.assertPushedTimes(SendReceipt, 1);
fake.restore();
```

## Notes

- Runs on Bun only (1.4 or newer).
- `connection: "sync"` runs jobs inline; `"memory"` waits for `queue.work()`. For `"database"` or `"redis"`, pass a `DatabaseQueueDriver` or `RedisQueueDriver` as `driver`.
- Failed jobs go to a `FailedJobRepository` (`MemoryFailedJobRepository` or `DatabaseFailedJobRepository`); retry them with `queue.retry(id)`.
- Job classes also support `delay`, `timeout`, `maxExceptions`, `afterCommit`, middleware (`WithoutOverlapping`, `RateLimited`) and uniqueness locks.
- `bunyad queue:work`, `queue:failed` and `queue:retry` come from [`@bunyad/cli`](https://www.npmjs.com/package/@bunyad/cli).

## License

MIT
