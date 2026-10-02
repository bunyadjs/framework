# @bunyad/filesystem

A disk-based storage abstraction with local, in-memory and S3-compatible filesystems and a `Storage` facade with a test fake.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/filesystem@beta
# or: npm install @bunyad/filesystem@beta
```

## Usage

```ts
import { LocalFilesystem, StorageManager, Storage, setStorage } from "@bunyad/filesystem";

setStorage(
  new StorageManager({
    default: "local",
    disks: { local: new LocalFilesystem({ root: "storage/app", url: "/storage" }) },
  }),
);

await Storage.put("notes/a.txt", "hello");
await Storage.exists("notes/a.txt");                    // true
new TextDecoder().decode(await Storage.get("notes/a.txt")); // "hello" (get returns Uint8Array)
Storage.disk().url("notes/a.txt");                      // "/storage/notes/a.txt"
await Storage.delete("notes/a.txt");                    // true

// In tests: swap every disk for an in-memory fake
Storage.fake();
await Storage.put("avatar.png", "bytes");
Storage.assertExists("avatar.png");
Storage.restore();
```

Other disks: `MemoryFilesystem`, and `S3Filesystem({ accessKeyId, secretAccessKey, bucket, endpoint?, region?, url? })`. Select a disk with `Storage.disk("name")`; the helpers also cover `copy`, `move`, `files`, `directories`, `size`, `mimeType`, `temporaryUrl`, `readStream` and `writeStream`.

## Notes

- Bun only (Bun 1.4 or newer).
- `S3Filesystem` uses Bun's built-in S3 client; no extra driver is needed. Without `url`, `url()` returns a presigned GET URL.
- Depends on `@bunyad/contracts`.

## License

MIT
