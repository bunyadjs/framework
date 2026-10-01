/**
 * Minimal HTTP contracts shared across packages.
 * Full Request/Response helpers live in @bunyad/http.
 */

export type Next = (
  request?: RequestContract,
) => Promise<Response> | Response;

export interface RequestContract {
  readonly raw: Request;
  readonly method: string;
  readonly url: string;
  input(key: string, defaultValue?: unknown): unknown;
  all(): Record<string, unknown>;
  header(name: string): string | null;
  bearerToken(): string | undefined;
}

export interface ResponseFactory {
  make(body?: string | Uint8Array | ReadableStream | null, init?: ResponseInit): Response;
  json(data: unknown, status?: number): Response;
  redirect(url: string, status?: number): Response;
}

/**
 * Objects returned from controllers that build a Fetch Response from the request
 * (e.g. Inertia page responses).
 */
export interface Responsable {
  toResponse(request: RequestContract): Response | Promise<Response>;
}

export function isResponsable(value: unknown): value is Responsable {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as Responsable).toResponse === "function"
  );
}
