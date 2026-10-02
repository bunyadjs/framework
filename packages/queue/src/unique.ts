import type { Job } from "./job.ts";
import { cache } from "@bunyad/cache";

const PREFIX = "bunyad-unique-job:";

/** `ShouldBeUnique` — unique while lock TTL is held. */
export type ShouldBeUnique = {
  uniqueId(): string;
  /** Lock TTL in seconds. Default 3600. */
  uniqueFor?: number;
};

/** `ShouldBeUniqueUntilProcessing` — release lock when job starts. */
export type ShouldBeUniqueUntilProcessing = ShouldBeUnique & {
  /** Marker — presence of this method or flag. */
  shouldBeUniqueUntilProcessing?: true;
};

export function jobImplementsUnique(job: Job): job is Job & ShouldBeUnique {
  return typeof (job as unknown as ShouldBeUnique).uniqueId === "function";
}

export function jobUniqueUntilProcessing(job: Job): boolean {
  if (!jobImplementsUnique(job)) return false;
  const flagged = (job as ShouldBeUniqueUntilProcessing)
    .shouldBeUniqueUntilProcessing;
  if (flagged === true) return true;
  // Class name / interface duck: method uniqueUntilProcessing exists
  return (
    typeof (job as unknown as { uniqueUntilProcessing?: () => boolean })
      .uniqueUntilProcessing === "function" &&
    (job as unknown as { uniqueUntilProcessing: () => boolean }).uniqueUntilProcessing()
  );
}

export function uniqueJobCacheKey(job: Job & ShouldBeUnique): string {
  return `${PREFIX}${job.constructor.name}:${job.uniqueId()}`;
}

/** Acquire unique lock; returns false when a duplicate should not be dispatched. */
export async function acquireUniqueJobLock(
  job: Job & ShouldBeUnique,
): Promise<boolean> {
  const ttl = job.uniqueFor ?? 3600;
  return cache().add(uniqueJobCacheKey(job), job.uuid(), ttl);
}

export async function releaseUniqueJobLock(
  job: Job & ShouldBeUnique,
): Promise<void> {
  await cache().forget(uniqueJobCacheKey(job));
}
