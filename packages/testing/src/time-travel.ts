/** Test clock helpers (`travel` / `freezeTime`). */

type ClockState = {
  frozen: boolean;
  offsetMs: number;
  frozenAt: number | null;
};

const state: ClockState = {
  frozen: false,
  offsetMs: 0,
  frozenAt: null,
};

const RealDate = Date;

function nowMs(): number {
  if (state.frozen && state.frozenAt != null) {
    return state.frozenAt + state.offsetMs;
  }
  return RealDate.now() + state.offsetMs;
}

function installFakeDate(): void {
  // eslint-disable-next-line no-global-assign
  (globalThis as { Date: typeof Date }).Date = class extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(nowMs());
      } else {
        super(...(args as [number]));
      }
    }
    static override now(): number {
      return nowMs();
    }
  } as typeof Date;
}

function restoreRealDate(): void {
  (globalThis as { Date: typeof Date }).Date = RealDate;
}

/** Move the clock forward/back by milliseconds, seconds string, or to a Date. */
export function travel(
  to: number | Date | string,
): void {
  installFakeDate();
  if (to instanceof Date) {
    state.frozen = true;
    state.frozenAt = to.getTime();
    state.offsetMs = 0;
    return;
  }
  if (typeof to === "string") {
    // "+1 hour" / "-5 minutes" style
    const match = to.trim().match(/^([+-]?\d+)\s*(ms|s|sec|seconds|m|min|minutes|h|hours|d|days)?$/i);
    if (match) {
      const n = Number(match[1]);
      const unit = (match[2] ?? "ms").toLowerCase();
      let ms = n;
      if (unit.startsWith("s")) ms = n * 1000;
      else if (unit.startsWith("m") && unit !== "ms") ms = n * 60_000;
      else if (unit.startsWith("h")) ms = n * 3_600_000;
      else if (unit.startsWith("d")) ms = n * 86_400_000;
      state.offsetMs += ms;
      return;
    }
    const parsed = RealDate.parse(to);
    if (!Number.isNaN(parsed)) {
      state.frozen = true;
      state.frozenAt = parsed;
      state.offsetMs = 0;
    }
    return;
  }
  state.offsetMs += to;
}

/** Freeze time at the current (possibly offset) instant. */
export function freezeTime(at?: Date | number): void {
  installFakeDate();
  state.frozen = true;
  state.frozenAt =
    at == null
      ? nowMs()
      : at instanceof Date
        ? at.getTime()
        : at;
  state.offsetMs = 0;
}

/** Restore the real system clock. */
export function travelBack(): void {
  state.frozen = false;
  state.offsetMs = 0;
  state.frozenAt = null;
  restoreRealDate();
}
