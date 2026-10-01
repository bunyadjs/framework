import { Seeder } from "@bunyad/database";
import User from "../../app/Models/User.ts";

/** Demo rows that only exist on the secondary connection. */
export async function seedSecondaryUsers(): Promise<void> {
  if ((await User.on("secondary").count()) > 0) return;

  await User.on("secondary").create({
    name: "Secondary Ada",
    email: "ada@secondary.test",
    password: "secret",
  });
  await User.on("secondary").create({
    name: "Secondary Bob",
    email: "bob@secondary.test",
    password: "secret",
  });
}

export default class SecondaryUserSeeder extends Seeder {
  async run(): Promise<void> {
    await seedSecondaryUsers();
  }
}
