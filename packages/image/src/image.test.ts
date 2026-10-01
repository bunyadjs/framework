import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  LocalFilesystem,
  Storage,
  StorageManager,
  setStorage,
} from "@bunyad/filesystem";
import { Image, selectImageDriver } from "../src/index.ts";

async function pngBytes(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 20, g: 120, b: 110 },
      },
    })
      .png()
      .toBuffer(),
  );
}

test("Image.fromBytes cover and toWebp", async () => {
  const input = await pngBytes(800, 600);
  const out = Image.fromBytes(input).cover(200, 200).toWebp().quality(80);
  expect(await out.width()).toBe(200);
  expect(await out.height()).toBe(200);
  expect(await out.mimeType()).toBe("image/webp");
  expect(await out.extension()).toBe("webp");
  const bytes = await out.toBytes();
  expect(bytes.byteLength).toBeGreaterThan(0);
});

test("Image.flip flop toFormat hashName transform", async () => {
  const input = await pngBytes(80, 60);
  const flipped = Image.fromBytes(input).flip().flop().toFormat("jpeg", 70);
  expect(await flipped.mimeType()).toBe("image/jpeg");
  const name = await Image.fromBytes(input).cover(40, 40).toPng().hashName("img");
  expect(name).toMatch(/^img\/[a-f0-9]+\.png$/);
  expect(await Image.fromBytes(input).cover(40, 40).toPng().hashName("img")).not.toBe(
    name,
  );
  const via = await Image.fromBytes(input)
    .transform("cover", 50, 50)
    .dimensions();
  expect(via).toEqual([50, 50]);
  const clone = Image.fromBytes(input).withClone((img) => img.scale(40, 40));
  expect(await clone.width()).toBe(40);

  const piped = Image.fromBytes(input)
    .transform({ op: "cover", width: 40, height: 40 })
    .flip()
    .flop()
    .toFormat("webp");
  expect(await piped.dimensions()).toEqual([40, 40]);
  expect(await piped.mimeType()).toBe("image/webp");
  const hashed = await piped.hashName("avatars");
  expect(hashed.startsWith("avatars/")).toBe(true);
  expect(hashed.endsWith(".webp")).toBe(true);
  expect(await piped.hashName("avatars")).toBe(hashed);

  const cloned = Image.fromBytes(input)
    .withClone((img) => img.cover(20, 20))
    .withOutput((encode) => {
      encode.format = "png";
    });
  expect(await cloned.dimensions()).toEqual([20, 20]);
  expect(await cloned.mimeType()).toBe("image/png");
  expect(cloned.newClone()).not.toBe(cloned);

  const again = Image.fromBytes(input).orientate().cover(20, 20);
  expect(await again.dimensions()).toEqual([20, 20]);
});

test("sourceDimensions ignores pending transforms", async () => {
  const input = await pngBytes(220, 110);
  const image = Image.fromBytes(input).cover(50, 50);
  expect(await image.sourceDimensions()).toEqual([220, 110]);
  expect(await image.dimensions()).toEqual([50, 50]);
});

test("Image.scale never enlarges", async () => {
  const input = await pngBytes(100, 80);
  const [w, h] = await Image.fromBytes(input).scale(400, 400).dimensions();
  expect(w).toBe(100);
  expect(h).toBe(80);
});

test("Image.resize with named width only", async () => {
  const input = await pngBytes(400, 200);
  const [w, h] = await Image.fromBytes(input)
    .resize({ width: 200 })
    .dimensions();
  expect(w).toBe(200);
  expect(h).toBe(100);
});

test("Image.when / unless", async () => {
  const input = await pngBytes(300, 300);
  const cropped = await Image.fromBytes(input)
    .when(true, (img) => img.cover(100, 100))
    .unless(true, (img) => img.toJpeg())
    .toPng()
    .dimensions();
  expect(cropped).toEqual([100, 100]);
});

test("Image.fromPath and storeAs via Storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-image-"));
  const file = join(dir, "in.png");
  await writeFile(file, await pngBytes(120, 80));

  const storageRoot = join(dir, "storage");
  await mkdir(storageRoot, { recursive: true });
  setStorage(
    new StorageManager({
      disks: { local: new LocalFilesystem({ root: storageRoot }) },
    }),
  );

  const path = await Image.fromPath(file)
    .cover(60, 60)
    .toJpeg()
    .storeAs("avatars", "me.jpg");
  expect(path).toBe("avatars/me.jpg");
  expect(await Storage.exists("avatars/me.jpg")).toBe(true);
});

test("Image.fromStorage round-trip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-image-st-"));
  setStorage(
    new StorageManager({
      disks: { local: new LocalFilesystem({ root: dir }) },
    }),
  );
  await Storage.put("src.png", await pngBytes(50, 40));

  const [w, h] = await Image.fromStorage("src.png")
    .scale({ width: 25 })
    .dimensions();
  expect(w).toBeLessThanOrEqual(25);
  expect(h).toBeLessThanOrEqual(20);
});

test("Image.fromUpload", async () => {
  const bytes = await pngBytes(64, 64);
  const file = {
    mimeType: "image/png",
    getClientOriginalName: () => "a.png",
    bytes: async () => bytes,
  };
  const [w, h] = await Image.fromUpload(file).cover(32, 32).dimensions();
  expect(w).toBe(32);
  expect(h).toBe(32);
});

test("validation dimensions rule uses Image probe", async () => {
  const { validate, ValidationException, Rule } = await import(
    "@bunyad/validation"
  );
  const bytes = await pngBytes(100, 80);
  const photo = {
    size: bytes.byteLength,
    mimeType: "image/png",
    getClientOriginalName: () => "photo.png",
    clientOriginalExtension: () => "png",
    bytes: async () => bytes,
  };

  await expect(
    validate(
      { photo },
      { photo: "dimensions:min_width=50,min_height=40,max_width=200" },
    ),
  ).resolves.toBeTruthy();

  await expect(
    validate({ photo }, { photo: Rule.dimensions({ min_width: 200 }) }),
  ).rejects.toBeInstanceOf(ValidationException);

  await expect(
    validate({ photo }, { photo: "dimensions:ratio=5/4" }),
  ).resolves.toBeTruthy();
});

test("Image.read from bytes/path/upload + fromBase64", async () => {
  const input = await pngBytes(64, 48);
  expect(await Image.read(input).cover(32, 32).dimensions()).toEqual([32, 32]);

  const dir = await mkdtemp(join(tmpdir(), "bunyad-image-read-"));
  const file = join(dir, "in.png");
  await writeFile(file, input);
  expect(await Image.read(file).width()).toBe(64);

  const upload = {
    getClientOriginalName: () => "u.png",
    bytes: async () => input,
  };
  expect(await Image.read(upload).height()).toBe(48);

  const b64 = Buffer.from(input).toString("base64");
  expect(await Image.fromBase64(b64).dimensions()).toEqual([64, 48]);
  expect(
    await Image.fromBase64(`data:image/png;base64,${b64}`).dimensions(),
  ).toEqual([64, 48]);
});

test("Image.store / storePublicly set visibility", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-image-store-"));
  setStorage(
    new StorageManager({
      disks: { local: new LocalFilesystem({ root: dir }) },
    }),
  );

  const stored = await Image.fromBytes(await pngBytes(40, 40))
    .cover(20, 20)
    .toWebp()
    .store("avatars");
  expect(typeof stored).toBe("string");
  expect(stored).toMatch(/^avatars\/[a-f0-9]+\.webp$/);
  expect(await Storage.exists(stored as string)).toBe(true);

  const pub = await Image.fromBytes(await pngBytes(30, 30))
    .toPng()
    .storePubliclyAs("public-avatars", "me.png");
  expect(pub).toBe("public-avatars/me.png");
  expect(await Storage.getVisibility("public-avatars/me.png")).toBe("public");
});

test("selectImageDriver prefers Bun.Image when supported", () => {
  expect(
    selectImageDriver(
      [
        { op: "resize", width: 100 },
        { op: "flipVertically" },
        { op: "grayscale" },
      ],
      { format: "webp", quality: 80 },
    ),
  ).toBe("bun");
  expect(
    selectImageDriver([{ op: "scale", width: 40, height: 40 }], {
      format: "jpeg",
    }),
  ).toBe("bun");
  expect(selectImageDriver([{ op: "rotate", degrees: 90 }])).toBe("bun");

  expect(selectImageDriver([{ op: "cover", width: 40, height: 40 }])).toBe(
    "sharp",
  );
  expect(selectImageDriver([{ op: "blur", amount: 10 }])).toBe("sharp");
  expect(selectImageDriver([{ op: "crop", width: 10, height: 10 }])).toBe(
    "sharp",
  );
  expect(selectImageDriver([], { format: "gif" })).toBe("sharp");
  expect(selectImageDriver([{ op: "rotate", degrees: 45 }])).toBe("sharp");
  expect(selectImageDriver([{ op: "resize", height: 100 }])).toBe("sharp");
});

test("Bun.Image path encodes resize flip grayscale jpeg", async () => {
  const input = await pngBytes(120, 80);
  const out = Image.fromBytes(input)
    .resize(60)
    .flip()
    .grayscale()
    .toJpeg()
    .quality(75);
  expect(selectImageDriver([{ op: "resize", width: 60 }, { op: "flipVertically" }, { op: "grayscale" }], { format: "jpeg", quality: 75 })).toBe("bun");
  expect(await out.width()).toBe(60);
  expect(await out.height()).toBe(40);
  expect(await out.mimeType()).toBe("image/jpeg");
  expect((await out.toBytes()).byteLength).toBeGreaterThan(0);
});

test("crop contain rotate blur grayscale optimize encode helpers", async () => {
  const input = await pngBytes(200, 100);
  expect(await Image.fromBytes(input).crop(80, 60).dimensions()).toEqual([
    80, 60,
  ]);
  expect(await Image.fromBytes(input).crop(50, 40, 10, 5).dimensions()).toEqual(
    [50, 40],
  );
  expect(
    await Image.fromBytes(input).contain(120, 120).dimensions(),
  ).toEqual([120, 120]);
  expect(
    await Image.fromBytes(input).contain(120, 120, "dominant").dimensions(),
  ).toEqual([120, 120]);

  const rotated = Image.fromBytes(input).rotate(90).toPng();
  expect(await rotated.dimensions()).toEqual([100, 200]);

  const fx = Image.fromBytes(input)
    .blur(20)
    .sharpen(15)
    .grayscale()
    .optimize("webp", 60);
  expect(await fx.mimeType()).toBe("image/webp");
  expect((await fx.toBytes()).byteLength).toBeGreaterThan(0);

  const uri = await Image.fromBytes(input).toJpeg().toDataUri();
  expect(uri.startsWith("data:image/jpeg;base64,")).toBe(true);
  const b64 = await Image.fromBytes(input).toPng().toBase64();
  expect(b64.length).toBeGreaterThan(20);

  const hex = await Image.fromBytes(input).dominantColor();
  expect(hex).toMatch(/^#[0-9a-f]{6}$/);
});
