import type { Filesystem } from "@bunyad/contracts";
import { MemoryFilesystem } from "./memory-filesystem.ts";
import {
  getStorage,
  setStorage,
  StorageManager,
} from "./manager.ts";

/**
 * Records filesystem operations in memory (`Storage.fake()`).
 */
export class StorageFake extends MemoryFilesystem {
  assertExists(path: string | string[]): void {
    const paths = Array.isArray(path) ? path : [path];
    for (const p of paths) {
      if (!this.entries.has(p)) {
        throw new Error(`Expected file [${p}] to exist.`);
      }
    }
  }

  assertMissing(path: string | string[]): void {
    const paths = Array.isArray(path) ? path : [path];
    for (const p of paths) {
      if (this.entries.has(p)) {
        throw new Error(`Expected file [${p}] to be missing.`);
      }
    }
  }

  assertCount(count: number, directory = ""): void {
    const dir = directory.replace(/^\/+|\/+$/g, "");
    let size = this.entries.size;
    if (dir) {
      const prefix = `${dir}/`;
      size = 0;
      for (const file of this.entries.keys()) {
        if (file.startsWith(prefix) || file === dir) size++;
      }
    }
    if (size !== count) {
      throw new Error(`Expected ${count} file(s), got ${size}.`);
    }
  }

  assertEmpty(): void {
    if (this.entries.size !== 0) {
      throw new Error(
        `Expected disk to be empty, got ${this.entries.size} file(s).`,
      );
    }
  }

  assertDirectoryEmpty(path = ""): void {
    const dir = path.replace(/^\/+|\/+$/g, "");
    const prefix = dir ? `${dir}/` : "";
    for (const file of this.entries.keys()) {
      if (dir) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        if (rest && !rest.includes("/")) {
          throw new Error(
            `Expected directory [${dir}] to be empty, found [${file}].`,
          );
        }
      } else if (!file.includes("/")) {
        throw new Error(`Expected root directory to be empty, found [${file}].`);
      }
    }
  }
}

let previousStorage: StorageManager | undefined;
let fakedDiskName: string | undefined;
let previousDiskForFake: Filesystem | undefined;
let hadPreviousDisk = false;
/** When no manager existed, fake() installed a fresh manager. */
let replacedManager = false;

function requireStorageFake(): StorageFake {
  const manager = getStorage() as StorageManager | undefined;
  if (!manager) {
    throw new Error("Call Storage.fake() before asserting stored files.");
  }
  const name = fakedDiskName ?? manager.getDefaultDriver();
  const disk = manager.disk(name);
  if (!(disk instanceof StorageFake)) {
    throw new Error("Call Storage.fake() before asserting stored files.");
  }
  return disk;
}

/**
 * Swap a disk for an in-memory fake.
 * Omitting `disk` fakes the current default driver.
 */
export function fakeStorage(disk?: string): StorageFake {
  const existing = getStorage() as StorageManager | undefined;
  const fake = new StorageFake();

  if (!existing) {
    const name = disk ?? "local";
    previousStorage = undefined;
    previousDiskForFake = undefined;
    hadPreviousDisk = false;
    replacedManager = true;
    fakedDiskName = name;
    setStorage(new StorageManager({ default: name, disks: { [name]: fake } }));
    return fake;
  }

  const name = disk ?? existing.getDefaultDriver();
  previousStorage = existing;
  replacedManager = false;
  fakedDiskName = name;

  try {
    previousDiskForFake = existing.disk(name);
    hadPreviousDisk = true;
  } catch {
    previousDiskForFake = undefined;
    hadPreviousDisk = false;
  }

  existing.set(name, fake);
  return fake;
}

export function restoreStorage(): void {
  if (replacedManager) {
    if (previousStorage) setStorage(previousStorage);
  } else if (previousStorage && fakedDiskName) {
    if (hadPreviousDisk && previousDiskForFake) {
      previousStorage.set(fakedDiskName, previousDiskForFake);
    } else {
      previousStorage.forgetDisk(fakedDiskName);
    }
  }
  previousStorage = undefined;
  previousDiskForFake = undefined;
  hadPreviousDisk = false;
  replacedManager = false;
  fakedDiskName = undefined;
}

export { requireStorageFake };
