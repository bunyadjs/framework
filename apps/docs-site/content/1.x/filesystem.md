---
title: File Storage
description: Store and retrieve files on local disks and S3-compatible storage through the Storage facade.
---

# File Storage

## Introduction

Bunyad gives you one API for files on disk and in object storage. Configure named disks in `config/filesystems.ts`, then read and write through the `Storage` facade from `@bunyad/filesystem`. Switch the default disk with `FILESYSTEM_DISK` without changing call sites.

```ts
import { Storage } from "@bunyad/filesystem";

await Storage.put("reports/daily.txt", "ok");
const bytes = await Storage.get("reports/daily.txt");
const text = new TextDecoder().decode(bytes);
```

`FilesystemServiceProvider` builds the disks at boot and calls `setStorage`. Facade methods forward to the default disk unless you pass a name to `Storage.disk()`.

## Configuration

Framework apps load `config/filesystems.ts`. Relative `root` values resolve under `storage/` via `app.storagePath()`:

```ts title="config/filesystems.ts"
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
      url: process.env.APP_URL
        ? `${process.env.APP_URL}/storage`
        : "/storage",
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
```

| Key | Role |
| --- | --- |
| `default` | Disk used by `Storage.put`, `Storage.get`, and friends. Defaults to `FILESYSTEM_DISK` or `local`. |
| `disks.*.driver` | `local` or `s3`. |
| `disks.*.root` | Local root. Relative paths sit under `storage/` (so `app` → `storage/app`). Absolute paths are used as-is. |
| `disks.*.url` | Prefix for `url()`. On S3, omit this to fall back to a short-lived presigned GET URL. |
| Env vars | S3 credentials. Used when a disk field is missing. |

If `config/filesystems` is empty, the provider still registers `local` (`storage/app`) and `public` (`storage/app/public`, url `/storage`). An `s3` entry is skipped until `bucket` or `AWS_BUCKET` is set.

A minimal app that does not load the framework provider wires the manager yourself:

```ts
import {
  LocalFilesystem,
  StorageManager,
  setStorage,
} from "@bunyad/filesystem";

setStorage(
  new StorageManager({
    default: "local",
    disks: {
      local: new LocalFilesystem({ root: "./storage/app" }),
    },
  }),
);
```

### The local driver

All operations are relative to the disk `root`. Path segments that escape the root (`..`, absolute paths) throw.

```ts
await Storage.disk("local").put("example.txt", "Contents");
// → storage/app/example.txt when root is "app"
```

### The public disk

Use the `public` disk for files you intend to serve over HTTP. By default it writes under `storage/app/public` and builds URLs with the configured `url` prefix (often `/storage/...`).

Expose that directory from your web root:

```bash
bunyad storage:link
```

That creates `public/storage` → `storage/app/public`. Pass `--force` to replace an existing link. After linking, a file at `photos/me.jpg` on the public disk is reachable at `/storage/photos/me.jpg` when your static server maps `public/`.

### S3-compatible disks

The `s3` driver uses Bun's `S3Client`. It works with Amazon S3, Cloudflare R2, MinIO, and other S3-compatible endpoints:

```ini
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=us-east-1
AWS_BUCKET=
AWS_URL=
AWS_ENDPOINT=
```

```ts
await Storage.disk("s3").put("uploads/invoice.pdf", pdfBytes);
const url = Storage.disk("s3").url("uploads/invoice.pdf");
```

When `url` / `AWS_URL` is set, `url()` joins that prefix with the object key. Otherwise it returns a one-hour presigned GET URL.

## Obtaining disk instances

```ts
const local = Storage.disk("local");
const same = Storage.drive("local"); // alias of disk()
const cloud = Storage.cloud(); // disk named by the manager's cloud driver (default "s3")
```

Calls on `Storage` without a disk use the default:

```ts
await Storage.put("file.txt", "hi");
await Storage.disk().exists("file.txt");
```

### On-demand disks

`Storage.build` creates a disk that is not in config. A string is a local root. An object may set `driver: "local"` plus `root` / `url`, or a driver you registered with `extend`:

```ts
const scratch = Storage.build("/tmp/scratch");
const named = Storage.build({
  driver: "local",
  root: "/var/data/exports",
  url: "https://cdn.example/exports",
});
```

### Custom drivers

```ts
import { MemoryFilesystem, Storage } from "@bunyad/filesystem";

Storage.extend("memory", () => new MemoryFilesystem());

Storage.set("scratch", new MemoryFilesystem());
```

`extend` registers a factory looked up by name in `disk()` and `build()`. `set` installs a ready instance. `forgetDisk` / `purge` drop cached instances (purge with no name clears every disk).

```ts
Storage.setDefaultDriver("public");
Storage.getDefaultDriver(); // "public"
Storage.setDefaultCloudDriver("s3");
```

## Retrieving files

`get` returns `Uint8Array`. Decode text yourself when you need a string. Missing files throw.

```ts
const bytes = await Storage.get("file.jpg");
const text = new TextDecoder().decode(await Storage.get("notes.txt"));
const data = await Storage.json<{ count: number }>("stats.json");
```

```ts
await Storage.exists("file.jpg");
await Storage.missing("file.jpg");
await Storage.fileExists("file.jpg");
await Storage.fileMissing("file.jpg");
```

### Downloading files

`download` and `response` return a Fetch `Response` with the file body, Content-Type from `mimeType`, and a Content-Disposition header:

```ts
return await Storage.download("reports/q1.pdf", "quarter.pdf");
return await Storage.response("photos/me.jpg"); // inline by default
```

### File URLs

```ts
const url = Storage.url("file.jpg");
const url = Storage.disk("public").url("avatars/me.jpg");
```

Local disks join the configured `url` prefix. With no prefix, the path is returned as `/file.jpg`.

### Temporary URLs

S3 disks support temporary download and upload URLs. Local disks throw if you call these methods.

```ts
if (Storage.disk("s3").providesTemporaryUrls()) {
  const url = await Storage.disk("s3").temporaryUrl(
    "private/report.pdf",
    new Date(Date.now() + 5 * 60_000),
  );
}

const upload = await Storage.disk("s3").temporaryUploadUrl(
  "incoming/upload.bin",
  new Date(Date.now() + 60_000),
);
// { url, headers }
```

Default expiration is one hour from now when you omit the `Date`.

### File metadata

```ts
await Storage.size("file.jpg"); // bytes
await Storage.lastModified("file.jpg"); // unix seconds
await Storage.mimeType("file.jpg");
Storage.path("file.jpg"); // absolute path on local; object key on S3
await Storage.checksum("file.jpg"); // md5 by default
await Storage.checksum("file.jpg", "sha256");
```

### Streams

```ts
const stream = await Storage.readStream("large.bin");
await Storage.writeStream("copy.bin", stream);
```

## Storing files

```ts
await Storage.put("file.jpg", contents); // string or Uint8Array
await Storage.prepend("file.log", "Line zero\n");
await Storage.append("file.log", "Line one\n");
```

### Copying and moving

```ts
await Storage.copy("old.jpg", "new.jpg");
await Storage.move("old.jpg", "archive/old.jpg");
```

### File uploads

`putFile` stores under a directory with a generated name (or `hashName()` when the source provides it). `putFileAs` uses the name you pass. Both accept a string, `Uint8Array`, `Blob`, or an upload-like object with `arrayBuffer()`:

```ts
const path = await Storage.putFile("avatars", request.file("photo")!);
const path = await Storage.putFileAs(
  "avatars",
  request.file("photo")!,
  "me.jpg",
  "public",
);
```

Visibility may be `"public"` | `"private"`, or `{ visibility: "public" }`.

Uploaded files also expose `store` / `storeAs` / `storePublicly` / `storePubliclyAs` on `@bunyad/http`'s `UploadedFile`, which write through `Storage` the same way.

### File visibility

Visibility is tracked per path on the disk instance (`public` or `private`). Local drivers do not change OS permissions; S3 does not map visibility to ACL yet — use these helpers when your app logic needs the flag (for example after `storePublicly` from the image package).

```ts
await Storage.setVisibility("file.jpg", "public");
await Storage.getVisibility("file.jpg");
```

## Deleting files

```ts
await Storage.delete("file.jpg"); // true if removed, false if missing
```

## Directories

```ts
await Storage.makeDirectory("docs");
await Storage.directoryExists("docs");
await Storage.directoryMissing("docs");

await Storage.files("docs"); // non-recursive
await Storage.allFiles("docs"); // recursive
await Storage.directories("docs");
await Storage.allDirectories("docs");

await Storage.deleteDirectory("docs");
```

## Conditional helpers

`when` / `unless` run a callback against the disk and return the same disk for chaining:

```ts
Storage.disk("local").when(import.meta.env.DEV, (disk) => {
  // inspect or warm the disk in development
});
```

## Testing

`Storage.fake()` swaps a disk for an in-memory `StorageFake`. Omit the name to fake the default disk; pass a name to fake only that disk and leave the others alone.

```ts
import { Storage } from "@bunyad/filesystem";

Storage.fake();
// or Storage.fake("s3");

await Storage.put("avatar.png", "bytes");

Storage.assertExists("avatar.png");
Storage.assertExists(["avatar.png"]);
Storage.assertMissing("missing.png");
Storage.assertCount(1);
Storage.assertCount(1, "avatars");
Storage.assertEmpty();
Storage.assertDirectoryEmpty("avatars");

Storage.restore();
```

Call `fake` before the assertions. `restore` puts the previous disk (or manager) back.

## Image manipulation

Resize, encode, and store images with the `Image` facade. See [Image Manipulation](/docs/1.x/images). Load a stored file with `Image.fromStorage(path, disk)` — disks do not expose an `image()` method.
