import { describe, expect, test } from "bun:test";
import { validate, ValidationException } from "@bunyad/validation";
import { UploadedFile } from "./index.ts";

const bytes = (...values: Array<number | string>): number[] =>
  values.flatMap((value) => (typeof value === "string" ? Array.from(value, (c) => c.charCodeAt(0)) : [value]));
const pad = (head: number[], to = 64): number[] => [...head, ...new Array(Math.max(0, to - head.length)).fill(0)];
const upload = (name: string, content: number[] | string) =>
  new UploadedFile(new Blob([typeof content === "string" ? content : new Uint8Array(content)]), name);

async function passes(file: UploadedFile, rule: string): Promise<boolean> {
  try {
    await validate({ f: file }, { f: rule });
    return true;
  } catch (error) {
    if (error instanceof ValidationException) return false;
    throw error;
  }
}

const ZIP = pad([0x50, 0x4b, 0x03, 0x04]);
const OLE = pad([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MOV = pad(bytes(0, 0, 0, 0x14, "ftypqt  "));
const M4A = pad(bytes(0, 0, 0, 0x18, "ftypM4A "));
const MP4 = pad(bytes(0, 0, 0, 0x18, "ftypisom"));
const HEIC = pad(bytes(0, 0, 0, 0x18, "ftypheic"));
const MP3_NO_ID3 = pad([0xff, 0xfb, 0x90, 0x00]);
// 'BM', size, reserved 0, offset, DIB header size 40
const BMP = pad([0x42, 0x4d, 0x46, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0, 40, 0, 0, 0]);

describe("mimes accepts every extension a container type can carry", () => {
  const cases: Array<[string, number[], string[], string[]]> = [
    ["zip bytes", ZIP, ["zip", "docx", "xlsx", "pptx", "odt"], ["pdf", "png", "mp3"]],
    ["old office (OLE) bytes", OLE, ["doc", "xls", "ppt"], ["docx", "zip", "pdf"]],
    ["QuickTime", MOV, ["mov", "mp4"], ["mp3", "png"]],
    ["M4A audio", M4A, ["m4a", "mp4"], ["mp3", "png"]],
    ["MP4", MP4, ["mp4", "m4v"], ["mp3", "png"]],
    ["HEIC picture", HEIC, ["heic"], ["png", "mp4"]],
    ["MP3 without an ID3 tag", MP3_NO_ID3, ["mp3"], ["png", "wav"]],
    ["BMP", BMP, ["bmp"], ["png", "csv"]],
  ];
  for (const [label, content, good, bad] of cases) {
    test(label, async () => {
      for (const ext of good) {
        expect(await passes(upload(`file.${ext}`, content), `mimes:${ext}`)).toBe(true);
      }
      for (const ext of bad) {
        expect(await passes(upload(`file.${ext}`, content), `mimes:${ext}`)).toBe(false);
      }
    });
  }

  test("a CSV whose first letters are BM is still text", async () => {
    expect(await passes(upload("data.csv", "BMI,height\n1,2\n"), "mimes:csv")).toBe(true);
  });

  test("a text file renamed to xlsx is refused", async () => {
    expect(await passes(upload("data.xlsx", "just words"), "mimes:xlsx")).toBe(false);
  });
});
