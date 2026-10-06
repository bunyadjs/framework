import type { ResolvedDebugbarOptions } from "./types.ts";

let active: ResolvedDebugbarOptions | undefined;

/** The options of the running bar, or undefined when it is off. */
export function activeDebugbar(): ResolvedDebugbarOptions | undefined {
  return active;
}

export function setActiveDebugbar(options: ResolvedDebugbarOptions | undefined): void {
  active = options;
}
