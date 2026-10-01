import { Url } from "./url.ts";
import { action } from "./url.ts";
import type { RouteParamValue } from "./context.ts";
import { appendQueryParam } from "./query.ts";

/**
 * Fluent URI builder (`Uri::of` / `withQuery` / …).
 */
export class Uri {
  #url: URL;

  private constructor(url: URL) {
    this.#url = url;
  }

  static of(uri: string): Uri {
    return new Uri(new URL(uri, "http://localhost"));
  }

  static to(path: string): Uri {
    return Uri.of(Url.to(path));
  }

  static route(
    name: string,
    params: Record<string, RouteParamValue> = {},
  ): Uri {
    return Uri.of(Url.toRoute(name, params));
  }

  static signedRoute(
    name: string,
    params: Record<string, RouteParamValue> = {},
  ): Uri {
    return Uri.of(Url.signedRoute(name, params, true));
  }

  static temporarySignedRoute(
    name: string,
    expiration: Date | number,
    params: Record<string, RouteParamValue> = {},
  ): Uri {
    return Uri.of(Url.temporarySignedRoute(name, expiration, params, true));
  }

  static action(
    target: [new () => object, string] | (new () => object),
    params: Record<string, RouteParamValue> = {},
  ): Uri {
    return Uri.of(action(target, params, true));
  }

  withScheme(scheme: string): Uri {
    const next = new URL(this.#url.toString());
    next.protocol = `${scheme.replace(/:$/, "")}:`;
    return new Uri(next);
  }

  withHost(host: string): Uri {
    const next = new URL(this.#url.toString());
    next.host = host;
    return new Uri(next);
  }

  withPort(port: number | null): Uri {
    const next = new URL(this.#url.toString());
    next.port = port == null ? "" : String(port);
    return new Uri(next);
  }

  withPath(path: string): Uri {
    const next = new URL(this.#url.toString());
    next.pathname = path.startsWith("/") ? path : `/${path}`;
    return new Uri(next);
  }

  withQuery(query: Record<string, unknown>): Uri {
    const next = new URL(this.#url.toString());
    for (const [key, value] of Object.entries(query)) {
      if (
        !Array.isArray(value) &&
        (typeof value !== "object" || value === null)
      ) {
        next.searchParams.delete(key);
        for (const existing of [...next.searchParams.keys()]) {
          if (existing.startsWith(`${key}[`)) next.searchParams.delete(existing);
        }
      }
      appendQueryParam(next.searchParams, key, value);
    }
    return new Uri(next);
  }

  withFragment(fragment: string): Uri {
    const next = new URL(this.#url.toString());
    next.hash = fragment ? `#${fragment.replace(/^#/, "")}` : "";
    return new Uri(next);
  }

  path(): string {
    return this.#url.pathname;
  }

  toString(): string {
    return this.#url.toString();
  }

  valueOf(): string {
    return this.toString();
  }
}
