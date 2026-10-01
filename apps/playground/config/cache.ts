/**
 * Cache configuration.
 */
export default {
  default: process.env.CACHE_DRIVER ?? "memory",
  stores: {
    memory: { driver: "memory" },
    file: { driver: "file" },
    redis: {
      driver: "redis",
      connection: "cache",
      url: process.env.REDIS_URL,
    },
    database: {
      driver: "database",
      table: "cache",
    },
  },
};
