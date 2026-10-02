# @bunyad/image

A fluent image pipeline (resize, cover, crop, rotate, blur, format conversion) that reads from uploads, paths, URLs, bytes or `Storage` and writes back through `@bunyad/filesystem`.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/image@beta
# or: npm install @bunyad/image@beta
```

## Usage

```ts
import { Image } from "@bunyad/image";
import { LocalFilesystem, StorageManager, setStorage } from "@bunyad/filesystem";

setStorage(
  new StorageManager({ disks: { local: new LocalFilesystem({ root: "storage/app" }) } }),
);

const avatar = Image.fromPath("photo.png").cover(200, 200).toWebp().quality(80);

await avatar.dimensions();                  // [200, 200]
await avatar.mimeType();                    // "image/webp"
await avatar.storeAs("avatars", "me.webp"); // "avatars/me.webp"
await avatar.store("avatars");              // "avatars/<content-hash>.webp"
await avatar.toBytes();                     // Uint8Array
```

Sources: `Image.fromPath`, `fromBytes`, `fromBase64`, `fromUrl`, `fromStorage(path, disk?)`, `fromUpload`, and `Image.read(...)` which picks one. Transforms: `resize`, `scale`, `cover`, `contain`, `crop`, `orient`, `rotate`, `blur`, `sharpen`, `grayscale`, `flip`, `flop`. Output: `toJpeg`, `toPng`, `toWebp`, `toAvif`, `toGif`, `toBmp`, `toFormat`, `optimize`.

## Notes

- Bun only (Bun 1.4 or newer).
- Resize, flip and common encodes run on Bun's native image support; `cover`, `contain`, `crop`, `blur`, `sharpen` and formats Bun cannot encode fall back to `sharp`. `selectImageDriver(transforms, encode)` reports which backend a pipeline uses.
- `sharp` is a regular dependency (installed automatically); it ships prebuilt native binaries.
- Depends on `@bunyad/filesystem` for `fromStorage`, `store` and `storeAs`.

## License

MIT
