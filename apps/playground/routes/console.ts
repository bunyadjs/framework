import { schedule } from "@bunyad/schedule";
import PruneExpiredTokens from "../app/Jobs/PruneExpiredTokens.ts";

/**
 * Register scheduled tasks (Laravel `routes/console.php` / Kernel schedule).
 * Loaded by `cli schedule:run`, `schedule:work`, and `schedule:list`.
 */
export function registerSchedule(): void {
  schedule()
    .call(() => {
      console.log(`[schedule] heartbeat ${new Date().toISOString()}`);
    })
    .everyMinute()
    .name("heartbeat")
    .withoutOverlapping(5)
    .onOneServer();

  schedule()
    .job(new PruneExpiredTokens())
    .hourly()
    .timezone("UTC")
    .name("job:PruneExpiredTokens");

  schedule().command("queue:status").everyFiveMinutes().name("command:queue:status");
}
