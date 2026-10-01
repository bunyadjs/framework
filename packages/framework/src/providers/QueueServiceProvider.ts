import { ServiceProvider } from "@bunyad/core";
import type { Connection } from "@bunyad/database";
import { setMailQueue } from "@bunyad/mail";
import {
  QueueManager,
  setQueue,
  DatabaseQueueDriver,
  RedisQueueDriver,
  MemoryQueueDriver,
  MemoryFailedJobRepository,
  DatabaseFailedJobRepository,
  setBatchRepository,
  DatabaseBatchRepository,
  MemoryBatchRepository,
} from "@bunyad/queue";
import {
  Schedule,
  setSchedule,
  setScheduleJobRunner,
} from "@bunyad/schedule";
import { resolveRedisUrl } from "./database-config.ts";

export type QueueConnectionConfig = {
  driver?: string;
  url?: string;
  connection?: string;
};

export type QueueConfig = {
  default?: string;
  tries?: number;
  /** Legacy string failed driver, or `{ driver }`. */
  failed?: string | { driver?: string };
  connections?: Record<string, QueueConnectionConfig>;
};

function failedDriverName(config: QueueConfig): string {
  if (typeof config.failed === "string") return config.failed;
  return config.failed?.driver ?? process.env.QUEUE_FAILED_DRIVER ?? "";
}

function createQueue(
  connection: Connection,
  config: QueueConfig,
  redisUrl?: string,
): QueueManager {
  const name = config.default ?? process.env.QUEUE_CONNECTION ?? "sync";
  const connectionConfig = config.connections?.[name] ?? {};
  const driver = connectionConfig.driver ?? name;
  const failedName = failedDriverName(config);
  const failed =
    driver === "database" || failedName === "database"
      ? new DatabaseFailedJobRepository({ connection })
      : new MemoryFailedJobRepository();

  const tries = config.tries ?? Number(process.env.QUEUE_TRIES ?? 1);

  if (driver === "database") {
    setBatchRepository(new DatabaseBatchRepository({ connection }));
    return new QueueManager({
      driver: new DatabaseQueueDriver({
        connection,
        encrypt: process.env.QUEUE_ENCRYPT === "true",
      }),
      failed,
      tries,
    });
  }
  setBatchRepository(new MemoryBatchRepository());
  if (driver === "redis") {
    return new QueueManager({
      driver: new RedisQueueDriver({
        url: connectionConfig.url ?? redisUrl ?? process.env.REDIS_URL,
      }),
      failed,
      tries,
    });
  }
  if (driver === "memory") {
    return new QueueManager({
      driver: new MemoryQueueDriver(),
      failed,
      tries,
    });
  }
  return new QueueManager({ connection: "sync", failed, tries });
}

export class QueueServiceProvider extends ServiceProvider {
  register(): void {
    const connection = this.app.make<Connection>("db");
    const config = this.app.config.get<QueueConfig>("queue") ?? {};
    const redisName =
      config.connections?.[config.default ?? ""]?.connection ?? "default";
    const queue = createQueue(
      connection,
      config,
      resolveRedisUrl(this.app, redisName),
    );
    setQueue(queue);
    setMailQueue(queue);
    this.app.instance("queue", queue);

    setSchedule(
      new Schedule({
        mutexPath: this.app.storagePath("framework/schedule"),
        timezone: process.env.APP_TIMEZONE,
      }),
    );
    setScheduleJobRunner(async (job) => {
      await queue.dispatch(job as never);
    });
  }
}
