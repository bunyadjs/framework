/**
 * Filesystem / Storage disk contract.
 */

/**
 * `lib.dom`'s `HeadersInit` isn't ambient here (base tsconfig `lib` is
 * `ESNext`-only) — derive the same shape from the global `Headers`
 * constructor instead of widening `lib` project-wide.
 */
export type HeadersInitLike = ConstructorParameters<typeof Headers>[0];

export type FilesystemVisibility = "public" | "private";

export type FilesystemPutFileOptions =
  | FilesystemVisibility
  | { visibility?: FilesystemVisibility };

/** Uploaded file / blob-like input for `putFile` / `putFileAs`. */
export type FilesystemFileSource =
  | string
  | Uint8Array
  | Blob
  | {
      hashName?(path?: string): string;
      getClientOriginalName?(): string;
      getFilename?(): string;
      bytes?(): Promise<Uint8Array> | Uint8Array;
      arrayBuffer(): Promise<ArrayBuffer>;
    };

export interface Filesystem {
  put(path: string, contents: string | Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  /** Inverse of `exists`. */
  missing(path: string): Promise<boolean>;
  delete(path: string): Promise<boolean>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /** Non-recursive file list under `directory`. */
  files(directory?: string): Promise<string[]>;
  /** Recursive file list under `directory`. */
  allFiles(directory?: string): Promise<string[]>;
  url(path: string): string;

  append(path: string, data: string | Uint8Array): Promise<void>;
  prepend(path: string, data: string | Uint8Array): Promise<void>;
  directories(directory?: string): Promise<string[]>;
  allDirectories(directory?: string): Promise<string[]>;
  makeDirectory(path: string): Promise<boolean>;
  deleteDirectory(directory: string): Promise<boolean>;
  directoryExists(path: string): Promise<boolean>;
  directoryMissing(path: string): Promise<boolean>;
  fileExists(path: string): Promise<boolean>;
  fileMissing(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  lastModified(path: string): Promise<number>;
  mimeType(path: string): Promise<string>;
  path(path?: string): string;
  putFile(
    path: string,
    file: FilesystemFileSource,
    options?: FilesystemPutFileOptions,
  ): Promise<string>;
  putFileAs(
    path: string,
    file: FilesystemFileSource,
    name: string,
    options?: FilesystemPutFileOptions,
  ): Promise<string>;
  readStream(path: string): Promise<ReadableStream<Uint8Array>>;
  writeStream(
    path: string,
    stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  ): Promise<void>;
  temporaryUrl(path: string, expiration?: Date): Promise<string>;
  temporaryUploadUrl(
    path: string,
    expiration?: Date,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  providesTemporaryUrls(): boolean;
  providesTemporaryUploadUrls(): boolean;
  checksum(path: string, algorithm?: string): Promise<string>;
  json<T = unknown>(path: string): Promise<T>;
  getVisibility(path: string): Promise<FilesystemVisibility>;
  setVisibility(path: string, visibility: FilesystemVisibility): Promise<void>;
  download(
    path: string,
    name?: string,
    headers?: Record<string, string>,
  ): Promise<Response>;
  response(
    path: string,
    name?: string,
    headers?: HeadersInitLike,
    disposition?: string,
  ): Promise<Response>;
  when(
    condition: boolean | ((disk: this) => boolean),
    callback: (disk: this) => unknown,
    defaultCallback?: (disk: this) => unknown,
  ): this;
  unless(
    condition: boolean | ((disk: this) => boolean),
    callback: (disk: this) => unknown,
    defaultCallback?: (disk: this) => unknown,
  ): this;
}
