/**
 * logging config.
 */
export default {
  default: process.env.LOG_CHANNEL ?? "stack",
  channels: {
    stack: {
      driver: "stack",
      channels: ["single"],
      level: process.env.LOG_LEVEL ?? "debug",
    },
    single: {
      driver: "single",
      path: "storage/logs/bunyad.log",
      level: process.env.LOG_LEVEL ?? "debug",
    },
    console: {
      driver: "console",
      level: process.env.LOG_LEVEL ?? "debug",
    },
  },
};
