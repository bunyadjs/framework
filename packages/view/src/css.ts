/**
 * Build a space-separated class string from conditional class lists / maps.
 * Numeric / string array entries are always included when truthy.
 * Object keys are included when their value is truthy.
 */
export function toCssClasses(input: unknown): string {
  const classes: string[] = [];
  collectClasses(input, classes);
  return classes.join(" ");
}

/**
 * Build a semicolon-separated style string from conditional style lists / maps.
 */
export function toCssStyles(input: unknown): string {
  const styles: string[] = [];
  collectStyles(input, styles);
  return styles.join("; ");
}

function collectClasses(input: unknown, out: string[]): void {
  if (input == null || input === false) return;
  if (typeof input === "string" || typeof input === "number") {
    const s = String(input).trim();
    if (s) out.push(s);
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) collectClasses(item, out);
    return;
  }
  if (typeof input === "object") {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (value) out.push(key);
    }
  }
}

function collectStyles(input: unknown, out: string[]): void {
  if (input == null || input === false) return;
  if (typeof input === "string") {
    const s = input.trim().replace(/;+\s*$/, "");
    if (s) out.push(s);
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) collectStyles(item, out);
    return;
  }
  if (typeof input === "object") {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (value === true) {
        const s = key.trim().replace(/;+\s*$/, "");
        if (s) out.push(s);
      } else if (value) {
        out.push(`${key}: ${value}`);
      }
    }
  }
}
