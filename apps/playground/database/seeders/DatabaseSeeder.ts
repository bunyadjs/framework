import { Seeder } from "@bunyad/database";
import UserSeeder from "./UserSeeder.ts";
import SecondaryUserSeeder from "./SecondaryUserSeeder.ts";

export default class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    await this.call(UserSeeder);
    await this.call(SecondaryUserSeeder);
  }
}
