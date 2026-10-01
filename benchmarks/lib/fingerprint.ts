/**
 * Machine / runtime fingerprint for benchmark result records.
 * Mirrors the fields printed by benchmarks/run.ts.
 */
import { cpus, totalmem, freemem } from "node:os";

export type EnvironmentFingerprint = {
  cpu: string;
  cpuCores: number;
  memoryGb: number;
  freeMemoryGb: number;
  os: string;
  arch: string;
};

export type RuntimeFingerprint = {
  name: "bun";
  version: string;
};

export type MachineFingerprint = {
  environment: EnvironmentFingerprint;
  runtime: RuntimeFingerprint;
};

/** Structured fingerprint used in JSON results. */
export function collectFingerprint(): MachineFingerprint {
  const cpuList = cpus();
  return {
    environment: {
      cpu: cpuList[0]?.model?.trim() || "unknown CPU",
      cpuCores: cpuList.length,
      memoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
      freeMemoryGb: Math.round((freemem() / 1024 ** 3) * 10) / 10,
      os: process.platform,
      arch: process.arch,
    },
    runtime: {
      name: "bun",
      version: Bun.version,
    },
  };
}

/** One-line summary matching run.ts style. */
export function formatFingerprintLine(
  fp: MachineFingerprint = collectFingerprint(),
): string {
  const { environment: env, runtime } = fp;
  return `machine: ${env.cpu} ×${env.cpuCores} | RAM ${env.memoryGb} GB (${env.freeMemoryGb} free) | ${env.os}/${env.arch} | Bun ${runtime.version}`;
}
