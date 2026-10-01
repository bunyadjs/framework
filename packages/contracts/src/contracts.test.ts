import { expect, test } from "bun:test";
import type {
  CacheStore,
  Filesystem,
  Mailer,
  QueueDriver,
  RequestContract,
  SessionStore,
} from "../src/index.ts";

test("contracts export usable interface shapes", () => {
  const cache: CacheStore = {
    async get() {
      return undefined;
    },
    async put() {},
    async forever() {},
    async forget() {
      return true;
    },
    async flush() {},
    async has() {
      return false;
    },
    async increment(_key, value = 1) {
      return value;
    },
    async decrement(_key, value = 1) {
      return -value;
    },
  };

  const queue: QueueDriver = {
    async push() {},
    async pop() {
      return undefined;
    },
    async size() {
      return 0;
    },
  };

  const session: SessionStore = {
    async read() {
      return undefined;
    },
    async write() {},
    async destroy() {},
  };

  const disk: Filesystem = {
    async put() {},
    async get() {
      return new Uint8Array();
    },
    async exists() {
      return false;
    },
    async missing() {
      return true;
    },
    async delete() {
      return true;
    },
    async copy() {},
    async move() {},
    async files() {
      return [];
    },
    async allFiles() {
      return [];
    },
    url(path) {
      return path;
    },
    async append() {},
    async prepend() {},
    async directories() {
      return [];
    },
    async allDirectories() {
      return [];
    },
    async makeDirectory() {
      return true;
    },
    async deleteDirectory() {
      return true;
    },
    async directoryExists() {
      return false;
    },
    async directoryMissing() {
      return true;
    },
    async fileExists() {
      return false;
    },
    async fileMissing() {
      return true;
    },
    async size() {
      return 0;
    },
    async lastModified() {
      return 0;
    },
    async mimeType() {
      return "application/octet-stream";
    },
    path(path = "") {
      return path;
    },
    async putFile() {
      return "";
    },
    async putFileAs() {
      return "";
    },
    async readStream() {
      return new ReadableStream();
    },
    async writeStream() {},
    async temporaryUrl() {
      return "";
    },
    async temporaryUploadUrl() {
      return { url: "", headers: {} };
    },
    providesTemporaryUrls() {
      return false;
    },
    providesTemporaryUploadUrls() {
      return false;
    },
    async checksum() {
      return "";
    },
    async json<T = unknown>() {
      return {} as T;
    },
    async getVisibility() {
      return "public";
    },
    async setVisibility() {},
    async download() {
      return new Response();
    },
    async response() {
      return new Response();
    },
    when() {
      return this;
    },
    unless() {
      return this;
    },
  };

  const mail: Mailer = {
    async send() {},
  };

  expect(cache).toBeDefined();
  expect(queue).toBeDefined();
  expect(session).toBeDefined();
  expect(disk).toBeDefined();
  expect(mail).toBeDefined();

  const req = {} as RequestContract;
  expect(req).toBeDefined();
});
