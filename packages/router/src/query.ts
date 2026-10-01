/**
 * Append nested query values (`columns[0]=a`) onto a URLSearchParams.
 */
export function appendQueryParam(
  params: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (value === null) {
    params.set(key, "");
    return;
  }
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      appendQueryParam(params, `${key}[${i}]`, item);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      appendQueryParam(params, `${key}[${child}]`, item);
    }
    return;
  }
  params.set(key, String(value));
}

/**
 * Merge query onto a path (absolute or relative). Existing keys are overwritten.
 */
export function mergeQuery(
  path: string,
  query: Record<string, unknown> = {},
  rootUrl = "http://localhost",
): string {
  const absolute = /^https?:\/\//i.test(path);
  const url = new URL(path, absolute ? undefined : rootUrl);
  for (const [key, value] of Object.entries(query)) {
    // Overwrite existing key (and any `key[...]` children) when setting a scalar.
    if (!Array.isArray(value) && (typeof value !== "object" || value === null)) {
      url.searchParams.delete(key);
      for (const existing of [...url.searchParams.keys()]) {
        if (existing.startsWith(`${key}[`)) url.searchParams.delete(existing);
      }
    }
    appendQueryParam(url.searchParams, key, value);
  }
  if (absolute) return url.toString();
  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

/**
 * Substitute `{param}` / `{param?}` placeholders; leftover params become the query string.
 * Missing optional params drop their segment.
 */
export function formatPathWithParams(
  uri: string,
  params: Record<string, string>,
): string {
  let path = uri;
  const used = new Set<string>();
  for (const [key, value] of Object.entries(params)) {
    const required = `{${key}}`;
    const optional = `{${key}?}`;
    if (path.includes(required)) {
      path = path.replaceAll(
        required,
        encodeURIComponent(value).replaceAll("%2F", "/"),
      );
      used.add(key);
    } else if (path.includes(optional)) {
      path = path.replaceAll(
        optional,
        encodeURIComponent(value).replaceAll("%2F", "/"),
      );
      used.add(key);
    }
  }
  // Drop unused optional segments: `/users/{user?}` → `/users`
  path = path.replace(/\/\{[A-Za-z_][A-Za-z0-9_]*\?\}/g, "");
  path = path.replace(/\{[A-Za-z_][A-Za-z0-9_]*\?\}/g, "");
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!used.has(key)) query[key] = value;
  }
  if (Object.keys(query).length === 0) return path || "/";
  return mergeQuery(path || "/", query);
}
