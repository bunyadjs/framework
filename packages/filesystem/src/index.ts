export {
  LocalFilesystem,
  type LocalFilesystemOptions,
  StorageManager,
  setStorage,
  getStorage,
  Storage,
  type StorageManagerOptions,
  type StorageDiskFactory,
} from "./manager.ts";
export { StorageFake } from "./storage-fake.ts";
export { MemoryFilesystem } from "./memory-filesystem.ts";
export { S3Filesystem, type S3FilesystemOptions } from "./s3.ts";
export { Disk } from "./disk.ts";
