export type TestResponse = Omit<Response, "json"> & {
  json<T = unknown>(): Promise<T>;
  assertStatus(status: number): TestResponse;
  assertOk(): TestResponse;
  assertSuccessful(): TestResponse;
  assertCreated(): TestResponse;
  assertAccepted(): TestResponse;
  assertNoContent(status?: number): TestResponse;
  assertForbidden(): TestResponse;
  assertUnauthorized(): TestResponse;
  assertNotFound(): TestResponse;
  assertBadRequest(): TestResponse;
  assertUnprocessable(): TestResponse;
  assertConflict(): TestResponse;
  assertGone(): TestResponse;
  assertMethodNotAllowed(): TestResponse;
  assertTooManyRequests(): TestResponse;
  assertPaymentRequired(): TestResponse;
  assertNotAcceptable(): TestResponse;
  assertUnsupportedMediaType(): TestResponse;
  assertRequestTimeout(): TestResponse;
  assertInternalServerError(): TestResponse;
  assertServiceUnavailable(): TestResponse;
  assertServerError(): TestResponse;
  assertClientError(): TestResponse;
  assertFound(): TestResponse;
  assertMovedPermanently(): TestResponse;
  assertNotModified(): TestResponse;
  assertTemporaryRedirect(): TestResponse;
  assertPermanentRedirect(): TestResponse;
  assertRedirect(uri?: string): TestResponse;
  assertRedirectContains(uri: string): TestResponse;
  assertLocation(uri: string): TestResponse;
  assertHeader(name: string, value?: string): TestResponse;
  assertHeaderContains(name: string, value: string): TestResponse;
  assertHeaderMissing(name: string): TestResponse;
  assertContent(value: string): Promise<TestResponse>;
  assertSee(text: string): Promise<TestResponse>;
  assertSeeText(text: string): Promise<TestResponse>;
  assertSeeHtml(text: string): Promise<TestResponse>;
  assertDontSee(text: string): Promise<TestResponse>;
  assertDontSeeText(text: string): Promise<TestResponse>;
  assertDontSeeHtml(text: string): Promise<TestResponse>;
  assertJson(expected: unknown): Promise<TestResponse>;
  assertExactJson(expected: unknown): Promise<TestResponse>;
  assertSimilarJson(expected: unknown): Promise<TestResponse>;
  assertJsonFragment(fragment: Record<string, unknown>): Promise<TestResponse>;
  assertJsonMissing(fragment: Record<string, unknown>): Promise<TestResponse>;
  assertJsonPath(path: string, expected?: unknown): Promise<TestResponse>;
  assertJsonCount(key: string | number, count?: number): Promise<TestResponse>;
  assertJsonStructure(structure: unknown): Promise<TestResponse>;
  assertJsonIsArray(): Promise<TestResponse>;
  assertJsonIsObject(): Promise<TestResponse>;
  tap(callback: (response: TestResponse) => void | Promise<void>): Promise<TestResponse>;
  when(
    condition: boolean,
    callback: (response: TestResponse) => void | Promise<void>,
  ): Promise<TestResponse>;
  unless(
    condition: boolean,
    callback: (response: TestResponse) => void | Promise<void>,
  ): Promise<TestResponse>;
};

function getJsonPath(value: unknown, path: string): unknown {
  const parts = path
    .replaceAll(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True when `actual` contains every key/value in `expected` (deep). */
function containsSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") {
    return actual === expected;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((item, i) => containsSubset(actual[i], item));
  }
  if (!isObject(actual)) return false;
  for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
    if (!containsSubset(actual[key], value)) return false;
  }
  return true;
}

function sortedJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(sortedJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${sortedJson(v)}`).join(",")}}`;
}

function assertStructure(actual: unknown, structure: unknown, path = ""): void {
  if (Array.isArray(structure)) {
    if (!Array.isArray(actual)) {
      throw new Error(`Expected array at ${path || "root"}, got ${typeof actual}.`);
    }
    if (structure.length === 0) return;
    if (actual.length === 0) {
      throw new Error(`Expected non-empty array at ${path || "root"}.`);
    }
    assertStructure(actual[0], structure[0], `${path}[0]`);
    return;
  }
  if (isObject(structure)) {
    if (!isObject(actual)) {
      throw new Error(`Expected object at ${path || "root"}, got ${typeof actual}.`);
    }
    for (const [key, nested] of Object.entries(structure)) {
      if (!(key in actual)) {
        throw new Error(`Missing attribute: ${path ? `${path}.` : ""}${key}`);
      }
      if (nested !== undefined && nested !== null && typeof nested === "object") {
        assertStructure(actual[key], nested, path ? `${path}.${key}` : key);
      }
    }
    return;
  }
}

function jsonContainsFragment(
  actual: unknown,
  fragment: Record<string, unknown>,
): boolean {
  if (containsSubset(actual, fragment)) return true;
  if (Array.isArray(actual)) {
    return actual.some((item) => jsonContainsFragment(item, fragment));
  }
  if (isObject(actual)) {
    return Object.values(actual).some((item) => jsonContainsFragment(item, fragment));
  }
  return false;
}

export function wrapResponse(response: Response): TestResponse {
  const wrapped = response as TestResponse;
  const parseJson = response.json.bind(response);
  wrapped.json = <T = unknown>() => parseJson() as Promise<T>;

  wrapped.assertStatus = (status: number) => {
    if (response.status !== status) {
      throw new Error(`Expected status ${status}, got ${response.status}`);
    }
    return wrapped;
  };
  wrapped.assertSuccessful = () => {
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Expected successful status, got ${response.status}`);
    }
    return wrapped;
  };
  wrapped.assertOk = () => wrapped.assertStatus(200);
  wrapped.assertCreated = () => wrapped.assertStatus(201);
  wrapped.assertAccepted = () => wrapped.assertStatus(202);
  wrapped.assertNoContent = (status = 204) => {
    wrapped.assertStatus(status);
    return wrapped;
  };
  wrapped.assertForbidden = () => wrapped.assertStatus(403);
  wrapped.assertUnauthorized = () => wrapped.assertStatus(401);
  wrapped.assertNotFound = () => wrapped.assertStatus(404);
  wrapped.assertBadRequest = () => wrapped.assertStatus(400);
  wrapped.assertUnprocessable = () => wrapped.assertStatus(422);
  wrapped.assertConflict = () => wrapped.assertStatus(409);
  wrapped.assertGone = () => wrapped.assertStatus(410);
  wrapped.assertMethodNotAllowed = () => wrapped.assertStatus(405);
  wrapped.assertTooManyRequests = () => wrapped.assertStatus(429);
  wrapped.assertPaymentRequired = () => wrapped.assertStatus(402);
  wrapped.assertNotAcceptable = () => wrapped.assertStatus(406);
  wrapped.assertUnsupportedMediaType = () => wrapped.assertStatus(415);
  wrapped.assertRequestTimeout = () => wrapped.assertStatus(408);
  wrapped.assertInternalServerError = () => wrapped.assertStatus(500);
  wrapped.assertServiceUnavailable = () => wrapped.assertStatus(503);
  wrapped.assertFound = () => wrapped.assertStatus(302);
  wrapped.assertMovedPermanently = () => wrapped.assertStatus(301);
  wrapped.assertNotModified = () => wrapped.assertStatus(304);
  wrapped.assertTemporaryRedirect = () => wrapped.assertStatus(307);
  wrapped.assertPermanentRedirect = () => wrapped.assertStatus(308);
  wrapped.assertServerError = () => {
    if (response.status < 500 || response.status >= 600) {
      throw new Error(`Expected server error status, got ${response.status}`);
    }
    return wrapped;
  };
  wrapped.assertClientError = () => {
    if (response.status < 400 || response.status >= 500) {
      throw new Error(`Expected client error status, got ${response.status}`);
    }
    return wrapped;
  };

  wrapped.assertRedirect = (uri?: string) => {
    if (response.status < 300 || response.status >= 400) {
      throw new Error(`Expected redirect status, got ${response.status}`);
    }
    if (uri !== undefined) {
      return wrapped.assertLocation(uri);
    }
    return wrapped;
  };
  wrapped.assertRedirectContains = (uri: string) => {
    if (response.status < 300 || response.status >= 400) {
      throw new Error(`Expected redirect status, got ${response.status}`);
    }
    const location = response.headers.get("Location") ?? "";
    if (!location.includes(uri)) {
      throw new Error(`Redirect location [${location}] does not contain [${uri}].`);
    }
    return wrapped;
  };
  wrapped.assertLocation = (uri: string) => {
    const location = response.headers.get("Location");
    if (location !== uri) {
      throw new Error(`Expected Location [${uri}], got [${location ?? ""}].`);
    }
    return wrapped;
  };

  wrapped.assertHeader = (name: string, value?: string) => {
    const actual = response.headers.get(name);
    if (actual == null) {
      throw new Error(`Header [${name}] not present on response.`);
    }
    if (value !== undefined && actual !== value) {
      throw new Error(`Header [${name}] was [${actual}], expected [${value}].`);
    }
    return wrapped;
  };
  wrapped.assertHeaderContains = (name: string, value: string) => {
    const actual = response.headers.get(name);
    if (actual == null || !actual.includes(value)) {
      throw new Error(
        `Header [${name}] does not contain [${value}] (got [${actual ?? ""}]).`,
      );
    }
    return wrapped;
  };
  wrapped.assertHeaderMissing = (name: string) => {
    if (response.headers.has(name)) {
      throw new Error(`Unexpected header [${name}] present on response.`);
    }
    return wrapped;
  };

  wrapped.assertContent = async (value: string) => {
    const body = await response.clone().text();
    if (body !== value) {
      throw new Error(`Expected content [${value}], got [${body}].`);
    }
    return wrapped;
  };
  wrapped.assertSee = async (text: string) => {
    const body = await response.clone().text();
    if (!body.includes(text)) {
      throw new Error(`Did not see [${text}] in response.`);
    }
    return wrapped;
  };
  wrapped.assertSeeText = wrapped.assertSee;
  wrapped.assertSeeHtml = wrapped.assertSee;
  wrapped.assertDontSee = async (text: string) => {
    const body = await response.clone().text();
    if (body.includes(text)) {
      throw new Error(`Unexpectedly saw [${text}] in response.`);
    }
    return wrapped;
  };
  wrapped.assertDontSeeText = wrapped.assertDontSee;
  wrapped.assertDontSeeHtml = wrapped.assertDontSee;

  wrapped.assertJson = async (expected: unknown) => {
    const body = await response.clone().json();
    if (!containsSubset(body, expected)) {
      throw new Error(
        `JSON does not contain expected subset.\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(body)}`,
      );
    }
    return wrapped;
  };
  wrapped.assertExactJson = async (expected: unknown) => {
    const body = await response.clone().json();
    if (JSON.stringify(body) !== JSON.stringify(expected)) {
      throw new Error(
        `JSON mismatch.\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(body)}`,
      );
    }
    return wrapped;
  };
  wrapped.assertSimilarJson = async (expected: unknown) => {
    const body = await response.clone().json();
    if (sortedJson(body) !== sortedJson(expected)) {
      throw new Error(
        `JSON mismatch (order-insensitive).\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(body)}`,
      );
    }
    return wrapped;
  };
  wrapped.assertJsonFragment = async (fragment: Record<string, unknown>) => {
    const body = await response.clone().json();
    if (!jsonContainsFragment(body, fragment)) {
      throw new Error(
        `Unable to find JSON fragment ${JSON.stringify(fragment)} within ${JSON.stringify(body)}.`,
      );
    }
    return wrapped;
  };
  wrapped.assertJsonMissing = async (fragment: Record<string, unknown>) => {
    const body = await response.clone().json();
    if (jsonContainsFragment(body, fragment)) {
      throw new Error(
        `Found unexpected JSON fragment ${JSON.stringify(fragment)} within response.`,
      );
    }
    return wrapped;
  };
  wrapped.assertJsonPath = async (path: string, expected?: unknown) => {
    const body = await response.clone().json();
    const actual = getJsonPath(body, path);
    if (expected === undefined) {
      if (actual === undefined) {
        throw new Error(`JSON path [${path}] is missing.`);
      }
      return wrapped;
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `JSON path [${path}] expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`,
      );
    }
    return wrapped;
  };
  wrapped.assertJsonCount = async (key: string | number, count?: number) => {
    const body = await response.clone().json();
    if (count === undefined && typeof key === "number") {
      if (!Array.isArray(body)) {
        throw new Error("Expected JSON root to be an array.");
      }
      if (body.length !== key) {
        throw new Error(`Expected JSON array count ${key}, got ${body.length}.`);
      }
      return wrapped;
    }
    const value = typeof key === "string" ? getJsonPath(body, key) : undefined;
    if (!Array.isArray(value)) {
      throw new Error(`Expected JSON path [${key}] to be an array.`);
    }
    if (value.length !== count) {
      throw new Error(`Expected JSON count ${count} at [${key}], got ${value.length}.`);
    }
    return wrapped;
  };
  wrapped.assertJsonStructure = async (structure: unknown) => {
    const body = await response.clone().json();
    assertStructure(body, structure);
    return wrapped;
  };
  wrapped.assertJsonIsArray = async () => {
    const body = await response.clone().json();
    if (!Array.isArray(body)) {
      throw new Error("Expected JSON response to be an array.");
    }
    return wrapped;
  };
  wrapped.assertJsonIsObject = async () => {
    const body = await response.clone().json();
    if (!isObject(body)) {
      throw new Error("Expected JSON response to be an object.");
    }
    return wrapped;
  };

  wrapped.tap = async (callback) => {
    await callback(wrapped);
    return wrapped;
  };
  wrapped.when = async (condition, callback) => {
    if (condition) await callback(wrapped);
    return wrapped;
  };
  wrapped.unless = async (condition, callback) => {
    if (!condition) await callback(wrapped);
    return wrapped;
  };

  return wrapped;
}
