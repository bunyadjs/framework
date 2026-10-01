import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Connection } from "@bunyad/database";
import { BUNYAD_CONNECTION } from "./tokens.ts";

/**
 * Closes the Bunyad connection when the Nest application shuts down.
 * Connection open happens in the `BUNYAD_CONNECTION` factory (module init).
 */
@Injectable()
export class BunyadOrmLifecycle implements OnModuleDestroy {
  constructor(
    @Inject(BUNYAD_CONNECTION) private readonly connection: Connection,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.connection.close();
  }
}
