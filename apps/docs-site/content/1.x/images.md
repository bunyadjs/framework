---
title: Image Manipulation
description: Resize, crop, encode, and store images with a fluent pipeline powered by Bun and sharp.
---

# Image Manipulation

## Introduction

`@bunyad/image` gives you a fluent pipeline for resizing, cropping, encoding, and storing images. Pipelines are immutable: each transform returns a new `PendingImage`. Bytes load lazily — the source is read when you inspect, encode, or store.

```ts
import { Image } from "@bunyad/image";

const path = await Image.fromStorage("avatars/photo.jpg", "public")
  .cover(400, 400)
  .toWebp()
  .quality(80)
  .storePublicly("avatars", "public");
```

Heavy work belongs on a queue when uploads are large. Prefer that over blocking the request that received the file.

Drivers are selected automatically: simple resize / flip / grayscale / orthogonal rotate paths may run on `Bun.Image`; cover, contain, crop, blur, sharpen, and formats Bun cannot encode fall through to **sharp** (a hard dependency of the package).

## Reading images

### Uploaded files

`request.image(key)` returns a `PendingImage` for a single upload, or `null` when the field is missing or is an array of files. It is async:

```ts
import type { Request } from "@bunyad/http";
import { validate } from "@bunyad/validation";

export default class AvatarController {
  async store(request: Request) {
    await validate(request.all(), {
      avatar: "required|image",
    });

    const image = await request.image("avatar");
    if (!image) {
      // missing or multi-file field
      return;
    }

    const path = await image
      .cover(400, 400)
      .toWebp()
      .storePublicly("avatars", "public");

    // ...
  }
}
```

Or build from an `UploadedFile` yourself:

```ts
import { Image } from "@bunyad/image";

const file = request.file("avatar");
if (file && !Array.isArray(file)) {
  const image = Image.fromUpload(file);
  const original = image.file(); // the UploadedFile
}
```

### Storage files

```ts
import { Image } from "@bunyad/image";

const image = Image.fromStorage("avatars/photo.jpg");
const image = Image.fromStorage("avatars/photo.jpg", "public");
```

There is no `Storage.disk().image()` helper — use `fromStorage`.

### Other sources

```ts
import { Image } from "@bunyad/image";

const image = Image.fromBytes(contents);
const image = Image.fromBase64(base64); // strips a data:…;base64, prefix when present
const image = Image.fromPath("/var/app/storage/app/avatars/photo.jpg");
const image = Image.fromUrl("https://example.com/photo.jpg");
```

`Image.read` picks a source from the argument shape:

```ts
Image.read(bytes);
Image.read("/path/to/photo.jpg");
Image.read("https://example.com/photo.jpg");
Image.read(uploadedFile);
```

## Manipulating images

Chain transforms. Order matters; encoding runs once at the end of the pipeline.

```ts
const image = (await request.image("avatar"))!
  .orient()
  .cover(400, 400)
  .sharpen(10);
```

### Resizing

`resize` sets exact dimensions. Pass both sides, or an options object with only `width` or only `height`:

```ts
image.resize(800, 600);
image.resize({ width: 800 });
image.resize({ height: 600 });
```

`scale` fits inside the given box and never enlarges:

```ts
image.scale(800, 600);
image.scale({ width: 800 });
```

`cover` fills the box and crops overflow:

```ts
image.cover(400, 400);
```

`contain` fits inside the box and may letterbox. Pass a CSS color or `"dominant"` to fill empty space with the source's dominant color:

```ts
image.contain(400, 400);
image.contain(400, 400, "#ffffff");
image.contain(400, 400, "dominant");
```

`crop` takes width, height, and optional origin:

```ts
image.crop(300, 200);
image.crop(300, 200, 50, 25);
image.crop(300, 200, { x: 50, y: 25 });
```

### Other transformations

```ts
image.orient(); // EXIF orientation; orientate() is an alias
image.rotate(90);
image.rotate(90, "#ffffff");
image.rotate(45, "dominant");
image.blur(5);
image.grayscale();
image.sharpen(10);
image.flipVertically();
image.flipHorizontally();
image.flip(); // vertical
image.flop(); // horizontal
```

### Conditional transforms

```ts
image
  .when(shouldCrop, (img) => img.cover(400, 400))
  .unless(keepFormat, (img) => img.toWebp());
```

### Custom transform objects

Pass a transform descriptor, or invoke a named fluent method:

```ts
image.transform({ op: "cover", width: 100, height: 100 });
image.transform("cover", 100, 100);
image.transform("blur", 5);
```

Unknown names throw. There is no separate driver registry for third-party transform classes.

### Cloning

```ts
const copy = image.newClone();
const scaled = image.withClone((img) => img.scale(40, 40));
```

## Encoding images

By default the processed format follows the source when possible. Convert explicitly before you read bytes or store:

```ts
image.toWebp();
image.toJpg();
image.toJpeg();
image.toPng();
image.toGif();
image.toAvif();
image.toBmp();
image.toFormat("webp", 80);
```

`quality` sets the encode quality for lossy formats:

```ts
image.toWebp().quality(80);
```

`optimize` sets format and quality together (default WebP at 70):

```ts
image.optimize();
image.optimize("jpg", 85);
```

`toBmp()` requests BMP; when sharp cannot emit BMP, the pipeline may fall back to PNG bytes while still labeling the format as requested — prefer PNG or WebP when you need a guaranteed encode.

Retrieve processed output:

```ts
const bytes = await image.toBytes();
const base64 = await image.toBase64();
const dataUri = await image.toDataUri();
```

## Storing images

`store` writes through `Storage` with a hashed filename and returns the relative path, or `false` on failure:

```ts
const path = await image.cover(400, 400).store("avatars");
const path = await image.cover(400, 400).store("avatars", "s3");
```

`storeAs` uses your filename:

```ts
const path = await image
  .cover(400, 400)
  .storeAs("avatars", "avatar.jpg", "public");
```

`storePublicly` / `storePubliclyAs` also call `setVisibility(..., "public")` on the target disk:

```ts
const path = await image
  .cover(400, 400)
  .storePublicly("avatars", "public");

const path = await image
  .cover(400, 400)
  .storePubliclyAs("avatars", "avatar.webp", "public");
```

Generate a hashed name without writing:

```ts
const name = await image.toPng().hashName("img");
// e.g. "img/a1b2….png"
```

## Inspecting images

These methods run the pipeline (except `dominantColor` / `sourceDimensions`, which use the source bytes):

```ts
await image.mimeType();
await image.extension();

const [width, height] = await image.dimensions();
await image.width();
await image.height();

const [sw, sh] = await image.sourceDimensions(); // before transforms
const hex = await image.dominantColor(); // source dominant RGB, e.g. "#3a7bd5"
```

After `cover(400, 400)`, `width()` is `400`.

## Drivers

You do not configure GD or Imagick. Processing picks **Bun** when the transform and encode set is supported, otherwise **sharp**. For diagnostics in tests:

```ts
import { selectImageDriver } from "@bunyad/image";

selectImageDriver([{ op: "scale", width: 100 }], { format: "webp" });
// "bun" | "sharp"
```

There is no `Image.extend`, `using("driver")`, or `config/images.ts` driver switch. Install `@bunyad/image` (and its sharp native binary) with your app dependencies; the framework re-exports `Image` and `PendingImage` from `@bunyad/framework` when you prefer a single import path.
