import { Job } from "@bunyad/queue";

/**
 * Example scheduled job — logs a prune tick (stand-in for token cleanup).
 */
export default class PruneExpiredTokens extends Job {
  async handle(): Promise<void> {
    console.log(`[job] PruneExpiredTokens at ${new Date().toISOString()}`);
  }
}
