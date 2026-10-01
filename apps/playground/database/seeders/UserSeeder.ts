import { Seeder } from "@bunyad/database";
import { Hash } from "@bunyad/auth";
import User from "../../app/Models/User.ts";

export default class UserSeeder extends Seeder {
  async run(): Promise<void> {
    await User.firstOrCreate(
      { email: "admin@example.com" },
      {
        name: "Admin",
        password: await Hash.make("secret"),
        tenant_id: "demo",
      },
    );
  }
}
