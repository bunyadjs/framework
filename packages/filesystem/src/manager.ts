import type {
  Filesystem,
  FilesystemFileSource,
  FilesystemPutFileOptions,
  FilesystemVisibility,
  HeadersInitLike,
} from "@bunyad/contracts";
import { LocalFilesystem, type LocalFilesystemOptions } from "./local.ts";
import {
  fakeStorage,
  requireStorageFake,
  restoreStorage,
  StorageFake,
} from "./storage-fake.ts";

export type StorageDiskFactory = (
  config?: Record<string, unknown>,
) => Filesystem;

export type StorageManagerOptions = {
  default?: string;
  cloud?: string;
  disks?: Record<string, Filesystem>;
};

/**
 * Storage disk manager (`Storage` facade).
 */
export class StorageManager {
  #default: string;
  #cloud: string;
  readonly #disks = new Map<string, Filesystem>();
  readonly #custom = new Map<string, StorageDiskFactory>();

  constructor(options: StorageManagerOptions = {}) {
    this.#default = options.default ?? "local";
    this.#cloud = options.cloud ?? "s3";
    for (const [name, disk] of Object.entries(options.disks ?? {})) {
      this.#disks.set(name, disk);
    }
  }

  disk(name = this.#default): Filesystem {
    const existing = this.#disks.get(name);
    if (existing) return existing;

    const custom = this.#custom.get(name);
    if (custom) {
      const created = custom();
      this.#disks.set(name, created);
      return created;
    }

    throw new Error(`Disk [${name}] is not configured.`);
  }

  /** Alias of {@link disk}. */
  drive(name?: string): Filesystem {
    return this.disk(name);
  }

  /** Resolve a named disk (manager `get`). */
  getDisk(name?: string): Filesystem {
    return this.disk(name);
  }

  cloud(): Filesystem {
    return this.disk(this.#cloud);
  }

  getDefaultDriver(): string {
    return this.#default;
  }

  setDefaultDriver(name: string): this {
    this.#default = name;
    return this;
  }

  getDefaultCloudDriver(): string {
    return this.#cloud;
  }

  setDefaultCloudDriver(name: string): this {
    this.#cloud = name;
    return this;
  }

  set(name: string, disk: Filesystem): this {
    this.#disks.set(name, disk);
    return this;
  }

  extend(driver: string, callback: StorageDiskFactory): this {
    this.#custom.set(driver, callback);
    return this;
  }

  /**
   * Build an on-demand disk. A string is treated as a local root path.
   */
  build(
    config: string | { driver?: string; root?: string; [key: string]: unknown },
  ): Filesystem {
    if (typeof config === "string") {
      return new LocalFilesystem({ root: config });
    }
    const driver = String(config.driver ?? "local");
    const custom = this.#custom.get(driver);
    if (custom) return custom(config);
    if (driver === "local") {
      const root = config.root;
      if (typeof root !== "string" || !root) {
        throw new Error("Local disk build() requires a root path.");
      }
      return new LocalFilesystem({
        root,
        url: typeof config.url === "string" ? config.url : undefined,
      });
    }
    throw new Error(`Disk driver [${driver}] is not supported by build().`);
  }

  forgetDisk(disk: string | string[]): this {
    const names = Array.isArray(disk) ? disk : [disk];
    for (const name of names) this.#disks.delete(name);
    return this;
  }

  purge(name?: string | null): this {
    if (name == null) {
      this.#disks.clear();
      return this;
    }
    this.#disks.delete(name);
    return this;
  }

  put(path: string, contents: string | Uint8Array): Promise<void> {
    return this.disk().put(path, contents);
  }

  get(path: string): Promise<Uint8Array> {
    return this.disk().get(path);
  }

  exists(path: string): Promise<boolean> {
    return this.disk().exists(path);
  }

  missing(path: string): Promise<boolean> {
    return this.disk().missing(path);
  }

  delete(path: string): Promise<boolean> {
    return this.disk().delete(path);
  }

  copy(from: string, to: string): Promise<void> {
    return this.disk().copy(from, to);
  }

  move(from: string, to: string): Promise<void> {
    return this.disk().move(from, to);
  }

  files(directory?: string): Promise<string[]> {
    return this.disk().files(directory);
  }

  allFiles(directory?: string): Promise<string[]> {
    return this.disk().allFiles(directory);
  }

  directories(directory?: string): Promise<string[]> {
    return this.disk().directories(directory);
  }

  allDirectories(directory?: string): Promise<string[]> {
    return this.disk().allDirectories(directory);
  }

  url(path: string): string {
    return this.disk().url(path);
  }

  append(path: string, data: string | Uint8Array): Promise<void> {
    return this.disk().append(path, data);
  }

  prepend(path: string, data: string | Uint8Array): Promise<void> {
    return this.disk().prepend(path, data);
  }

  makeDirectory(path: string): Promise<boolean> {
    return this.disk().makeDirectory(path);
  }

  deleteDirectory(directory: string): Promise<boolean> {
    return this.disk().deleteDirectory(directory);
  }

  directoryExists(path: string): Promise<boolean> {
    return this.disk().directoryExists(path);
  }

  directoryMissing(path: string): Promise<boolean> {
    return this.disk().directoryMissing(path);
  }

  fileExists(path: string): Promise<boolean> {
    return this.disk().fileExists(path);
  }

  fileMissing(path: string): Promise<boolean> {
    return this.disk().fileMissing(path);
  }

  size(path: string): Promise<number> {
    return this.disk().size(path);
  }

  lastModified(path: string): Promise<number> {
    return this.disk().lastModified(path);
  }

  mimeType(path: string): Promise<string> {
    return this.disk().mimeType(path);
  }

  path(path?: string): string {
    return this.disk().path(path);
  }

  putFile(
    path: string,
    file: FilesystemFileSource,
    options?: FilesystemPutFileOptions,
  ): Promise<string> {
    return this.disk().putFile(path, file, options);
  }

  putFileAs(
    path: string,
    file: FilesystemFileSource,
    name: string,
    options?: FilesystemPutFileOptions,
  ): Promise<string> {
    return this.disk().putFileAs(path, file, name, options);
  }

  readStream(path: string): Promise<ReadableStream<Uint8Array>> {
    return this.disk().readStream(path);
  }

  writeStream(
    path: string,
    stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  ): Promise<void> {
    return this.disk().writeStream(path, stream);
  }

  temporaryUrl(path: string, expiration?: Date): Promise<string> {
    return this.disk().temporaryUrl(path, expiration);
  }

  temporaryUploadUrl(
    path: string,
    expiration?: Date,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    return this.disk().temporaryUploadUrl(path, expiration);
  }

  providesTemporaryUrls(): boolean {
    return this.disk().providesTemporaryUrls();
  }

  providesTemporaryUploadUrls(): boolean {
    return this.disk().providesTemporaryUploadUrls();
  }

  checksum(path: string, algorithm?: string): Promise<string> {
    return this.disk().checksum(path, algorithm);
  }

  json<T = unknown>(path: string): Promise<T> {
    return this.disk().json<T>(path);
  }

  getVisibility(path: string): Promise<FilesystemVisibility> {
    return this.disk().getVisibility(path);
  }

  setVisibility(
    path: string,
    visibility: FilesystemVisibility,
  ): Promise<void> {
    return this.disk().setVisibility(path, visibility);
  }

  download(
    path: string,
    name?: string,
    headers?: Record<string, string>,
  ): Promise<Response> {
    return this.disk().download(path, name, headers);
  }

  response(
    path: string,
    name?: string,
    headers?: HeadersInitLike,
    disposition?: string,
  ): Promise<Response> {
    return this.disk().response(path, name, headers, disposition);
  }

  when(
    condition: boolean | ((disk: Filesystem) => boolean),
    callback: (disk: Filesystem) => unknown,
    defaultCallback?: (disk: Filesystem) => unknown,
  ): Filesystem {
    return this.disk().when(
      condition as never,
      callback as never,
      defaultCallback as never,
    );
  }

  unless(
    condition: boolean | ((disk: Filesystem) => boolean),
    callback: (disk: Filesystem) => unknown,
    defaultCallback?: (disk: Filesystem) => unknown,
  ): Filesystem {
    return this.disk().unless(
      condition as never,
      callback as never,
      defaultCallback as never,
    );
  }
}

let defaultStorage: StorageManager | undefined;

export function setStorage(manager: StorageManager): void {
  defaultStorage = manager;
}

export function getStorage(): StorageManager {
  return defaultStorage!;
}

/** `Storage` facade. */
export const Storage = {
  disk(name?: string): Filesystem {
    return name ? defaultStorage!.disk(name) : defaultStorage!.disk();
  },
  drive(name?: string): Filesystem {
    return defaultStorage!.drive(name);
  },
  build(
    config: string | { driver?: string; root?: string; [key: string]: unknown },
  ): Filesystem {
    return defaultStorage!.build(config);
  },
  cloud(): Filesystem {
    return defaultStorage!.cloud();
  },
  getDefaultDriver(): string {
    return defaultStorage!.getDefaultDriver();
  },
  setDefaultDriver(name: string): StorageManager {
    return defaultStorage!.setDefaultDriver(name);
  },
  getDefaultCloudDriver(): string {
    return defaultStorage!.getDefaultCloudDriver();
  },
  setDefaultCloudDriver(name: string): StorageManager {
    return defaultStorage!.setDefaultCloudDriver(name);
  },
  set(name: string, disk: Filesystem): StorageManager {
    return defaultStorage!.set(name, disk);
  },
  extend(driver: string, callback: StorageDiskFactory): StorageManager {
    return defaultStorage!.extend(driver, callback);
  },
  forgetDisk(disk: string | string[]): StorageManager {
    return defaultStorage!.forgetDisk(disk);
  },
  purge(name?: string | null): StorageManager {
    return defaultStorage!.purge(name);
  },
  put(path: string, contents: string | Uint8Array): Promise<void> {
    return defaultStorage!.put(path, contents);
  },
  get(path: string): Promise<Uint8Array> {
    return defaultStorage!.get(path);
  },
  exists(path: string): Promise<boolean> {
    return defaultStorage!.exists(path);
  },
  missing(path: string): Promise<boolean> {
    return defaultStorage!.missing(path);
  },
  delete(path: string): Promise<boolean> {
    return defaultStorage!.delete(path);
  },
  copy(from: string, to: string): Promise<void> {
    return defaultStorage!.copy(from, to);
  },
  move(from: string, to: string): Promise<void> {
    return defaultStorage!.move(from, to);
  },
  files(directory?: string): Promise<string[]> {
    return defaultStorage!.files(directory);
  },
  allFiles(directory?: string): Promise<string[]> {
    return defaultStorage!.allFiles(directory);
  },
  directories(directory?: string): Promise<string[]> {
    return defaultStorage!.directories(directory);
  },
  allDirectories(directory?: string): Promise<string[]> {
    return defaultStorage!.allDirectories(directory);
  },
  url(path: string): string {
    return defaultStorage!.url(path);
  },
  append(path: string, data: string | Uint8Array): Promise<void> {
    return defaultStorage!.append(path, data);
  },
  prepend(path: string, data: string | Uint8Array): Promise<void> {
    return defaultStorage!.prepend(path, data);
  },
  makeDirectory(path: string): Promise<boolean> {
    return defaultStorage!.makeDirectory(path);
  },
  deleteDirectory(directory: string): Promise<boolean> {
    return defaultStorage!.deleteDirectory(directory);
  },
  directoryExists(path: string): Promise<boolean> {
    return defaultStorage!.directoryExists(path);
  },
  directoryMissing(path: string): Promise<boolean> {
    return defaultStorage!.directoryMissing(path);
  },
  fileExists(path: string): Promise<boolean> {
    return defaultStorage!.fileExists(path);
  },
  fileMissing(path: string): Promise<boolean> {
    return defaultStorage!.fileMissing(path);
  },
  size(path: string): Promise<number> {
    return defaultStorage!.size(path);
  },
  lastModified(path: string): Promise<number> {
    return defaultStorage!.lastModified(path);
  },
  mimeType(path: string): Promise<string> {
    return defaultStorage!.mimeType(path);
  },
  path(path?: string): string {
    return defaultStorage!.path(path);
  },
  putFile(
    path: string,
    file: FilesystemFileSource,
    options?: FilesystemPutFileOptions,
  ): Promise<string> {
    return defaultStorage!.putFile(path, file, options);
  },
  putFileAs(
    path: string,
    file: FilesystemFileSource,
    name: string,
    options?: FilesystemPutFileOptions,
  ): Promise<string> {
    return defaultStorage!.putFileAs(path, file, name, options);
  },
  readStream(path: string): Promise<ReadableStream<Uint8Array>> {
    return defaultStorage!.readStream(path);
  },
  writeStream(
    path: string,
    stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  ): Promise<void> {
    return defaultStorage!.writeStream(path, stream);
  },
  temporaryUrl(path: string, expiration?: Date): Promise<string> {
    return defaultStorage!.temporaryUrl(path, expiration);
  },
  temporaryUploadUrl(
    path: string,
    expiration?: Date,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    return defaultStorage!.temporaryUploadUrl(path, expiration);
  },
  providesTemporaryUrls(): boolean {
    return defaultStorage!.providesTemporaryUrls();
  },
  providesTemporaryUploadUrls(): boolean {
    return defaultStorage!.providesTemporaryUploadUrls();
  },
  checksum(path: string, algorithm?: string): Promise<string> {
    return defaultStorage!.checksum(path, algorithm);
  },
  json<T = unknown>(path: string): Promise<T> {
    return defaultStorage!.json<T>(path);
  },
  getVisibility(path: string): Promise<FilesystemVisibility> {
    return defaultStorage!.getVisibility(path);
  },
  setVisibility(
    path: string,
    visibility: FilesystemVisibility,
  ): Promise<void> {
    return defaultStorage!.setVisibility(path, visibility);
  },
  download(
    path: string,
    name?: string,
    headers?: Record<string, string>,
  ): Promise<Response> {
    return defaultStorage!.download(path, name, headers);
  },
  response(
    path: string,
    name?: string,
    headers?: HeadersInitLike,
    disposition?: string,
  ): Promise<Response> {
    return defaultStorage!.response(path, name, headers, disposition);
  },
  when(
    condition: boolean | ((disk: Filesystem) => boolean),
    callback: (disk: Filesystem) => unknown,
    defaultCallback?: (disk: Filesystem) => unknown,
  ): Filesystem {
    return defaultStorage!.when(condition, callback, defaultCallback);
  },
  unless(
    condition: boolean | ((disk: Filesystem) => boolean),
    callback: (disk: Filesystem) => unknown,
    defaultCallback?: (disk: Filesystem) => unknown,
  ): Filesystem {
    return defaultStorage!.unless(condition, callback, defaultCallback);
  },
  fake(disk?: string): StorageFake {
    return fakeStorage(disk);
  },
  assertExists(path: string | string[]): void {
    requireStorageFake().assertExists(path);
  },
  assertMissing(path: string | string[]): void {
    requireStorageFake().assertMissing(path);
  },
  assertCount(count: number, directory?: string): void {
    requireStorageFake().assertCount(count, directory);
  },
  assertEmpty(): void {
    requireStorageFake().assertEmpty();
  },
  assertDirectoryEmpty(path = ""): void {
    requireStorageFake().assertDirectoryEmpty(path);
  },
  restore(): void {
    restoreStorage();
  },
};

export { LocalFilesystem, type LocalFilesystemOptions };
export type { StorageDiskFactory as StorageManagerExtendCallback };
