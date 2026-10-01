/**
 * Base seeder (Laravel `Seeder`).
 */
export abstract class Seeder {
  abstract run(): void | Promise<void>;

  /** Run another seeder class. */
  async call(SeederClass: new () => Seeder): Promise<void> {
    await new SeederClass().run();
  }
}
