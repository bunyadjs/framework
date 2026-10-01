/**
 * Laravel `config/queue.php` analogue.
 */
export default {
  default: process.env.QUEUE_CONNECTION ?? "memory",
  tries: Number(process.env.QUEUE_TRIES ?? 1),
  connections: {
    sync: { driver: "sync" },
    memory: { driver: "memory" },
    database: { driver: "database" },
    redis: {
      driver: "redis",
      connection: "default",
      url: process.env.REDIS_URL,
    },
  },
  failed: {
    driver: process.env.QUEUE_FAILED_DRIVER ?? "memory",
  },
};
