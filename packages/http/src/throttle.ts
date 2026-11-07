import type { Request } from "./request.ts";
import type { Next } from "./pipeline.ts";
import {
  getRateLimiter,
  Limit,
  type RateLimitResult,
  type RateLimiter,
} from "./rate-limiter.ts";
import { aliasMiddleware, taggedMiddleware } from "./middleware-alias.ts";
import { withHeaders } from "./response-headers.ts";

export type ThrottleOptions = {
  /** Max attempts per window (default 60). Ignored when using a named limiter. */
  maxAttempts?: number;
  /** Window length in minutes (default 1). Ignored when using a named limiter. */
  decayMinutes?: number;
  /** Build the rate-limit key (default: IP). Ignored when using a named limiter. */
  key?: (request: Request) => string;
  limiter?: RateLimiter;
};

function tooManyResponse(result: RateLimitResult): Response {
  const seconds = result.retryAfter;
  const message = `Too Many Attempts. Please try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
  return new Response(JSON.stringify({ message, retry_after: seconds }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfter),
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": "0",
    },
  });
}

function withRateHeaders(
  response: Response,
  result: RateLimitResult,
): Response {
  return withHeaders(response, (headers) => {
    headers.set("X-RateLimit-Limit", String(result.limit));
    headers.set("X-RateLimit-Remaining", String(result.remaining));
  });
}

function blockedResponse(
  limit: Limit,
  result: RateLimitResult,
): Response {
  return limit.responseFactory()?.(result) ?? tooManyResponse(result);
}

/**
 * `throttle:60,1` or `throttle:api` (named limiter).
 */
export function throttle(
  maxAttemptsOrName: number | string = 60,
  decayMinutes = 1,
  options: ThrottleOptions = {},
) {
  if (typeof maxAttemptsOrName === "string") {
    const name = maxAttemptsOrName;
    return taggedMiddleware(`throttle:${name}`, {
      async handle(request: Request, next: Next) {
        const rateLimiter = options.limiter ?? getRateLimiter();
        const callback = rateLimiter.limiter(name);
        if (!callback) {
          throw new Error(`Rate limiter [${name}] is not defined.`);
        }
        const raw = await callback(request);
        const limits = Array.isArray(raw) ? raw : [raw];
        const usesAfter = limits.some((l) => l.afterPredicate());

        if (usesAfter) {
          // Block before the handler runs once the key is exhausted; only failures count afterwards.
          for (const limit of limits) {
            if (limit.isUnlimited()) continue;
            const key = `named:${name}:${limit.key || request.ip()}`;
            if (await rateLimiter.tooManyAttempts(key, limit.maxAttempts)) {
              const retryAfter = await rateLimiter.availableIn(key, limit.maxAttempts);
              return blockedResponse(limit, {
                allowed: false,
                limit: limit.maxAttempts,
                remaining: 0,
                retryAfter,
                resetAt: Math.floor(Date.now() / 1000) + retryAfter,
              });
            }
          }
          const response = await next();
          let worst: RateLimitResult | undefined;
          for (const limit of limits) {
            if (limit.isUnlimited()) continue;
            const predicate = limit.afterPredicate();
            if (predicate && !predicate(response)) continue;
            const key = `named:${name}:${limit.key || request.ip()}`;
            const result = (await rateLimiter.attempt(
              key,
              limit.maxAttempts,
              limit.decaySeconds,
            )) as RateLimitResult;
            worst = result;
            if (!result.allowed) return blockedResponse(limit, result);
          }
          return worst ? withRateHeaders(response, worst) : response;
        }

        // Every limit is counted, and the request is blocked as soon as one of them is full.
        let tightest: RateLimitResult | undefined;
        for (const limit of limits) {
          if (limit.isUnlimited()) continue;
          const key = `named:${name}:${limit.key || request.ip()}`;
          const result = (await rateLimiter.attempt(
            key,
            limit.maxAttempts,
            limit.decaySeconds,
          )) as RateLimitResult;
          if (!result.allowed) return blockedResponse(limit, result);
          if (!tightest || result.remaining < tightest.remaining) tightest = result;
        }
        if (tightest) return withRateHeaders(await next(), tightest);

        return next();
      },
    });
  }

  const limit = options.maxAttempts ?? maxAttemptsOrName;
  const decay = (options.decayMinutes ?? decayMinutes) * 60;
  const keyFor = options.key ?? ((request: Request) => request.ip());

  return taggedMiddleware(`throttle:${limit},${decayMinutes}`, {
    async handle(request: Request, next: Next) {
      const rateLimiter = options.limiter ?? getRateLimiter();
      const key = `throttle:${keyFor(request)}`;
      const result = (await rateLimiter.attempt(
        key,
        limit,
        decay,
      )) as RateLimitResult;
      if (!result.allowed) return tooManyResponse(result);
      return withRateHeaders(await next(), result);
    },
  });
}

aliasMiddleware("throttle", (...params: string[]) => {
  if (params.length === 0) return throttle("api");
  if (params.length === 1 && Number.isNaN(Number(params[0]))) {
    return throttle(params[0]!);
  }
  return throttle(Number(params[0] ?? 60), Number(params[1] ?? 1));
});
