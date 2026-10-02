/**
 * broadcasting config.
 */
export default {
  default: process.env.BROADCAST_DRIVER ?? "sse",
  presence: process.env.PRESENCE_DRIVER,
  fanout: process.env.BROADCAST_FANOUT,
  connections: {
    sse: { driver: "sse" },
    log: { driver: "log" },
    sync: { driver: "sync" },
    pusher: {
      driver: "pusher",
      key: process.env.PUSHER_APP_KEY,
      secret: process.env.PUSHER_APP_SECRET,
      app_id: process.env.PUSHER_APP_ID,
      options: {
        cluster: process.env.PUSHER_APP_CLUSTER,
        host: process.env.PUSHER_HOST,
      },
    },
    ably: {
      driver: "ably",
      key: process.env.ABLY_API_KEY,
      host: process.env.ABLY_REST_HOST,
    },
  },
};
