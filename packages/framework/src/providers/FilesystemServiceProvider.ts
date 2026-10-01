import { isAbsolute } from "node:path";
import { ServiceProvider } from "@bunyad/core";
import {
  LocalFilesystem,
  S3Filesystem,
  StorageManager,
  setStorage,
} from "@bunyad/filesystem";

export type DiskConfig = {
  driver?: string;
  root?: string;
  url?: string;
  key?: string;
  secret?: string;
  region?: string;
  bucket?: string;
  endpoint?: string;
};

export type FilesystemsConfig = {
  default?: string;
  disks?: Record<string, DiskConfig>;
};

export class FilesystemServiceProvider extends ServiceProvider {
  register(): void {
    const config = this.app.config.get<FilesystemsConfig>("filesystems") ?? {};
    const diskDefs = config.disks ?? {
      local: { driver: "local", root: "app" },
      public: { driver: "local", root: "app/public", url: "/storage" },
    };

    const disks: Record<string, LocalFilesystem | S3Filesystem> = {};

    for (const [name, disk] of Object.entries(diskDefs)) {
      const driver = disk.driver ?? "local";
      if (driver === "s3") {
        if (!disk.bucket && !process.env.AWS_BUCKET) continue;
        disks[name] = new S3Filesystem({
          accessKeyId: disk.key ?? process.env.AWS_ACCESS_KEY_ID ?? "",
          secretAccessKey:
            disk.secret ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
          bucket: disk.bucket ?? process.env.AWS_BUCKET ?? "",
          endpoint: disk.endpoint ?? process.env.AWS_ENDPOINT,
          region: disk.region ?? process.env.AWS_DEFAULT_REGION,
          url: disk.url ?? process.env.AWS_URL,
        });
        continue;
      }

      const root = disk.root ?? "app";
      disks[name] = new LocalFilesystem({
        root: isAbsolute(root) ? root : this.app.storagePath(root),
        url: disk.url,
      });
    }

    if (!disks.local) {
      disks.local = new LocalFilesystem({
        root: this.app.storagePath("app"),
      });
    }

    setStorage(
      new StorageManager({
        default: config.default ?? process.env.FILESYSTEM_DISK ?? "local",
        disks,
      }),
    );
  }
}
