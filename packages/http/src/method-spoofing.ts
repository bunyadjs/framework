const SPOOFABLE = new Set(["PUT", "PATCH", "DELETE"]);

/**
 * Resolve the effective HTTP method for routing (Laravel `_method` spoofing).
 * Only POST may be rewritten. Prefer header, then query, then body field.
 */
export async function resolveRequestMethod(
  raw: globalThis.Request,
): Promise<string> {
  const method = raw.method.toUpperCase();
  if (method !== "POST") return method;

  const header =
    raw.headers.get("x-http-method-override") ??
    raw.headers.get("X-HTTP-Method-Override");
  if (header) {
    const verb = header.toUpperCase();
    if (SPOOFABLE.has(verb)) return verb;
  }

  try {
    const url = new URL(raw.url);
    const fromQuery = url.searchParams.get("_method");
    if (fromQuery) {
      const verb = fromQuery.toUpperCase();
      if (SPOOFABLE.has(verb)) return verb;
    }
  } catch {
    // ignore invalid URL
  }

  const type = (raw.headers.get("content-type") ?? "").toLowerCase();
  if (!type) return method;

  try {
    if (type.includes("application/json")) {
      const body = (await raw.clone().json()) as Record<string, unknown>;
      const value = body?._method;
      if (typeof value === "string" && SPOOFABLE.has(value.toUpperCase())) {
        return value.toUpperCase();
      }
    } else if (type.includes("application/x-www-form-urlencoded")) {
      const text = await raw.clone().text();
      const params = new URLSearchParams(text);
      const value = params.get("_method");
      if (value && SPOOFABLE.has(value.toUpperCase())) {
        return value.toUpperCase();
      }
    } else if (type.includes("multipart/form-data")) {
      const form = await raw.clone().formData();
      const value = form.get("_method");
      if (typeof value === "string" && SPOOFABLE.has(value.toUpperCase())) {
        return value.toUpperCase();
      }
    }
  } catch {
    // Body unreadable — keep POST
  }

  return method;
}
