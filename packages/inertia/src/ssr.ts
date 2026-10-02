import type { InertiaPage } from "./page.ts";

export type SsrRenderResult = {
  head: string[] | string;
  body: string;
};

/** In-process page renderer (Bun-native; no extra port). */
export type SsrRenderFn = (
  page: InertiaPage,
) => SsrRenderResult | Promise<SsrRenderResult>;

export type SsrMode = "inline" | "http";

export type SsrOptions = {
  /** When true, full-page responses use SSR (inline or HTTP). */
  enabled?: boolean;
  /**
   * `inline` — call `render` in-process (preferred on Bun).
   * `http` — POST to a remote SSR server.
   * Default: `inline` when `render` is set, otherwise `http`.
   */
  mode?: SsrMode;
  /** Required for `mode: "inline"`. */
  render?: SsrRenderFn;
  /** Base URL for `mode: "http"` (default `http://127.0.0.1:13714`). */
  url?: string;
  /** HTTP fetch timeout in milliseconds (default 3000). */
  timeout?: number;
  /** Component names that should skip SSR. */
  except?: string[];
};

let ssrOptions: SsrOptions = {};

export function configureSsr(options: SsrOptions): void {
  ssrOptions = { ...ssrOptions, ...options };
}

export function getSsrOptions(): SsrOptions {
  return { ...ssrOptions };
}

export function resetSsrOptions(): void {
  ssrOptions = {};
}

export function resolveSsrConfig(): {
  enabled: boolean;
  mode: SsrMode;
  render?: SsrRenderFn;
  url: string;
  timeout: number;
  except: string[];
} {
  const enabled =
    ssrOptions.enabled !== undefined
      ? ssrOptions.enabled
      : process.env.INERTIA_SSR_ENABLED === "1" ||
        process.env.INERTIA_SSR_ENABLED === "true";

  const envMode = process.env.INERTIA_SSR_MODE;
  const mode: SsrMode =
    ssrOptions.mode ??
    (envMode === "http" || envMode === "inline"
      ? envMode
      : ssrOptions.render
        ? "inline"
        : "http");

  return {
    enabled,
    mode,
    render: ssrOptions.render,
    url: (
      ssrOptions.url ??
      process.env.INERTIA_SSR_URL ??
      "http://127.0.0.1:13714"
    ).replace(/\/$/, ""),
    timeout: ssrOptions.timeout ?? Number(process.env.INERTIA_SSR_TIMEOUT ?? 3000),
    except: ssrOptions.except ?? [],
  };
}

export function formatSsrHead(head: string[] | string | undefined): string {
  if (head == null) return "";
  return Array.isArray(head) ? head.join("") : head;
}

/**
 * Render a page via inline `render` or HTTP `/render`.
 * Returns `null` on disable, except list, missing renderer, timeout, or error (CSR fallback).
 */
export async function dispatchSsr(
  page: InertiaPage,
  options?: SsrOptions,
): Promise<SsrRenderResult | null> {
  const base = resolveSsrConfig();
  const config = {
    enabled: options?.enabled ?? base.enabled,
    mode: options?.mode ?? base.mode,
    render: options?.render ?? base.render,
    url: (options?.url ?? base.url).replace(/\/$/, ""),
    timeout: options?.timeout ?? base.timeout,
    except: options?.except ?? base.except,
  };

  if (!config.enabled) return null;
  if (config.except.includes(page.component)) return null;

  if (config.mode === "inline") {
    if (!config.render) return null;
    try {
      const result = await config.render(page);
      if (typeof result?.body !== "string" || !result.body) return null;
      return {
        head: result.head ?? [],
        body: result.body,
      };
    } catch {
      return null;
    }
  }

  return dispatchSsrHttp(page, config.url, config.timeout);
}

async function dispatchSsrHttp(
  page: InertiaPage,
  url: string,
  timeout: number,
): Promise<SsrRenderResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${url}/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(page),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as Partial<SsrRenderResult> & {
      status?: string;
      message?: string;
    };

    if (typeof payload.body !== "string" || !payload.body) return null;

    return {
      head: payload.head ?? [],
      body: payload.body,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
