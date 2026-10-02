/**
 * filesystems config.
 * Disk roots are resolved relative to `storage/` unless absolute.
 */
export default {
  default: process.env.FILESYSTEM_DISK ?? "local",
  disks: {
    local: {
      driver: "local",
      root: "app",
    },
    public: {
      driver: "local",
      root: "app/public",
      url: process.env.APP_URL ? `${process.env.APP_URL}/storage` : "/storage",
    },
    s3: {
      driver: "s3",
      key: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_DEFAULT_REGION,
      bucket: process.env.AWS_BUCKET,
      url: process.env.AWS_URL,
      endpoint: process.env.AWS_ENDPOINT,
    },
  },
};
