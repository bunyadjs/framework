/**
 * Dot-path get for nested objects/arrays.
 * `data_get($target, $path, $default)`.
 */
export function dataGet(
  target: unknown,
  path: string | string[] | null | undefined,
  defaultValue: unknown = undefined,
): unknown {
  if (path === null || path === undefined || path === "") {
    return target ?? defaultValue;
  }
  const parts = Array.isArray(path) ? path : path.split(".");
  let current: unknown = target;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return valueOfDefault(defaultValue);
    }
    if (part === "*") {
      if (!Array.isArray(current)) return valueOfDefault(defaultValue);
      const rest = parts.slice(parts.indexOf(part) + 1);
      const mapped = current.map((item) =>
        rest.length === 0 ? item : dataGet(item, rest, defaultValue),
      );
      return mapped;
    }
    if (typeof current !== "object") {
      return valueOfDefault(defaultValue);
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current === undefined ? valueOfDefault(defaultValue) : current;
}

function valueOfDefault(defaultValue: unknown): unknown {
  return typeof defaultValue === "function"
    ? (defaultValue as () => unknown)()
    : defaultValue;
}

const isUnsafeKey = (key: string): boolean =>
  key === "__proto__" || key === "constructor" || key === "prototype";

/**
 * `data_set` — set a nested value by dot path (creates intermediates).
 * Mutates `target` and returns it.
 */
export function dataSet(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
  overwrite = true,
): Record<string, unknown> {
  const parts = path.split(".");
  // Never write through keys that reach Object.prototype.
  if (parts.some(isUnsafeKey)) return target;
  let current: Record<string, unknown> = target;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const isLast = i === parts.length - 1;

    if (part === "*") {
      // Wildcard set on array segments
      const list = current as unknown;
      if (!Array.isArray(list)) return target;
      const rest = parts.slice(i + 1).join(".");
      for (const item of list) {
        if (item !== null && typeof item === "object") {
          if (rest === "") {
            // shouldn't happen often
          } else {
            dataSet(item as Record<string, unknown>, rest, value, overwrite);
          }
        }
      }
      return target;
    }

    if (isLast) {
      if (overwrite || !(part in current) || current[part] === undefined) {
        current[part] = value;
      }
      return target;
    }

    if (
      current[part] === null ||
      current[part] === undefined ||
      typeof current[part] !== "object"
    ) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  return target;
}

/**
 * `data_fill` — `data_set` only when the key is missing.
 */
export function dataFill(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  return dataSet(target, path, value, false);
}

/**
 * `data_forget` — remove a nested key by dot path.
 */
export function dataForget(
  target: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const parts = path.split(".");
  let current: unknown = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current === null || typeof current !== "object") return target;
    current = (current as Record<string, unknown>)[part];
  }

  if (current !== null && typeof current === "object") {
    delete (current as Record<string, unknown>)[parts[parts.length - 1]!];
  }
  return target;
}
