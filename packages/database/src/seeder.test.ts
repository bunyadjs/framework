import { expect, test } from "bun:test";
import { Seeder } from "../src/seeder.ts";

class AlphaSeeder extends Seeder {
  static ran = false;
  async run() {
    AlphaSeeder.ran = true;
  }
}

class DatabaseSeeder extends Seeder {
  async run() {
    await this.call(AlphaSeeder);
  }
}

test("Seeder call runs nested seeder", async () => {
  AlphaSeeder.ran = false;
  await new DatabaseSeeder().run();
  expect(AlphaSeeder.ran).toBe(true);
});
