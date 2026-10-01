import { Seeder } from "@bunyad/database";
import User from "@/Models/User.ts";

export default class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    await User.factory().create({
      name: "Test User",
      email: "test@example.com",
    });
  }
}
