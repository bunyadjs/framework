/**
 * Feature store: `array` (in-memory) or `database`.
 */
export default {
  default: process.env.FEATURES_STORE ?? process.env.PENNANT_STORE ?? "database",
};
