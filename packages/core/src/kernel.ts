import {
  Request,
  addQueuedCookies,
  runPipeline,
  resolveMiddlewareStack,
  expandMiddlewareGroups,
  sortMiddlewareByPriority,
  mergeControllerMiddleware,
  HttpException,
  HttpResponseException,
  json,
  redirect,
  resolveRequestMethod,
  type Middleware,
} from "@bunyad/http";
import { isResponsable } from "@bunyad/contracts";
import { ValidationException } from "@bunyad/validation";
import {
  DdException,
  ddHtmlPage,
  enableHttpDd,
  flushDeferred,
  resolveDumpValues,
  runWithPaginatorRequest,
} from "@bunyad/common";
import type { InjectSlot, RouteAction, RouteDefinition, ControllerClass } from "@bunyad/router";
import type { Application } from "./application.ts";
import { notifyException, renderException, shouldReturnJson, statusFromError } from "./exception.ts";
import { resolveFormRequest } from "./form-request-action.ts";
import { stampControllerConstructorInject } from "./controller-constructor.ts";
import {
  getCachedControllerInjectPlan,
  invokeWithInjectPlan,
  resolveControllerInjectPlan,
} from "./route-model-action.ts";

/** Pathname from an absolute URL without `new URL()` allocation. */
export function pathnameOf(url: string): string {
  const host = url.indexOf("://");
  const start = url.indexOf("/", host === -1 ? 0 : host + 3);
  if (start === -1) return "/";
  const query = url.indexOf("?", start);
  const path = query === -1 ? url.slice(start) : url.slice(start, query);
  if (path.length > 1 && path.charCodeAt(path.length - 1) === 47) {
    return path.slice(0, -1);
  }
  return path;
}

type RouteDispatch = {
  bind: boolean;
  run: (request: Request) => Response | Promise<Response>;
  /** Zero-arg action with no middleware — skip wrapping Fetch Request. */
  bare?: () => Response | Promise<Response> | unknown;
};

const NOT_FOUND = new HttpException(404, "Not Found");
const FLUSH_FAILED = { failed: true };
const HTML_OK: ResponseInit = {
  headers: { "Content-Type": "text/html; charset=utf-8" },
};

function isPlainJsonObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Arrayable / JsonSerializable — Collection, Model, Paginator, … */
function hasJsonSerialize(value: object): value is { toJSON: () => unknown } {
  return typeof (value as { toJSON?: unknown }).toJSON === "function";
}

/**
 * Dispatch a Fetch Request through global + route middleware to the action.
 */
export class HttpKernel {
  #stackCache = new WeakMap<object, Middleware[]>();
  #dispatchCache = new WeakMap<object, RouteDispatch>();
  #failedResponses = new WeakSet<Response>();
  #unmatchedFor: Middleware[] | undefined;
  #unmatchedRun: ((request: Request) => Response | Promise<Response>) | undefined;
  #cachedGlobal: Middleware[] | null = null;
  #cachedPriority: readonly string[] | null = null;
  #controllers = new WeakMap<ControllerClass, object>();
  #lastRoute: object | undefined;
  #lastDispatch: RouteDispatch | undefined;

  constructor(private app: Application) {
    enableHttpDd();
  }

  handle(
    raw: globalThis.Request,
    pathname?: string,
  ): Response | Promise<Response> {
    // Always render exceptions as Responses so Bun's development overlay never
    // paints for handled HTTP errors.
    try {
      const result = this.#dispatch(raw, pathname);
      if (result instanceof Promise) {
        return result
          .catch((error) => this.#fail(error, new Request(raw)))
          .finally(() => {
            this.app.forgetScopedInstances();
          });
      }
      this.app.forgetScopedInstances();
      return result;
    } catch (error) {
      const rendered = this.#fail(error, new Request(raw));
      if (rendered instanceof Promise) {
        return rendered.finally(() => {
          this.app.forgetScopedInstances();
        });
      }
      this.app.forgetScopedInstances();
      return rendered;
    }
  }

  #resolvedStack(route: {
    middleware: unknown[];
    action: RouteAction;
  }): Middleware[] {
    const global = this.app.getMiddleware();
    const priority = this.app.getMiddlewarePriority();
    if (this.#cachedGlobal !== global || this.#cachedPriority !== priority) {
      this.#stackCache = new WeakMap();
      this.#dispatchCache = new WeakMap();
      this.#lastRoute = undefined;
      this.#cachedGlobal = global;
      this.#cachedPriority = priority;
    }

    const cached = this.#stackCache.get(route);
    if (cached) return cached;

    const expanded = expandMiddlewareGroups(
      route.middleware as Parameters<typeof expandMiddlewareGroups>[0],
      (name) => this.app.getMiddlewareGroup(name),
    );
    const sorted = sortMiddlewareByPriority(expanded, priority);
    const routeMw = resolveMiddlewareStack(sorted);
    const action = route.action;
    const controllerMw =
      typeof action !== "function"
        ? mergeControllerMiddleware(routeMw, action[0], action[1])
        : routeMw;
    const stack =
      controllerMw.length === 0
        ? global
        : global.length === 0
          ? controllerMw
          : global.concat(controllerMw);

    this.#stackCache.set(route, stack);
    return stack;
  }

  /**
   * Middleware sees a thrown action error as its rendered response (as in a
   * request pipeline), so CORS headers, `throttle` counting and `terminate` also apply to 422 / 404 / 500.
   */
  #wrapStack(
    stack: Middleware[],
    dest: (request: Request) => Response | Promise<Response>,
  ): (request: Request) => Response | Promise<Response> {
    if (stack.length === 0) return dest;
    const guarded = (request: Request): Response | Promise<Response> => {
      try {
        const result = dest(request);
        return result instanceof Promise
          ? result.catch((error) => this.#renderInPipeline(error, request))
          : result;
      } catch (error) {
        return this.#renderInPipeline(error, request);
      }
    };
    return (request) => runPipeline(request, stack, guarded);
  }

  #renderInPipeline(
    error: unknown,
    request: Request,
  ): Response | Promise<Response> {
    const rendered = this.#errorResponse(error, request);
    if (rendered instanceof Promise) {
      return rendered.then((response) => {
        this.#failedResponses.add(response);
        return response;
      });
    }
    this.#failedResponses.add(rendered);
    return rendered;
  }

  #actionDest(route: RouteDefinition): {
    run: (request: Request) => Response | Promise<Response>;
    bare?: () => unknown;
  } {
    const action = route.action;
    if (typeof action === "function") {
      const plan = route.inject;
      const run = (request: Request) =>
        this.#resolveResult(
          invokeWithInjectPlan(action, plan, request),
          request,
        );
      // Bare only when zero-arg and no inject/bind needs Request.
      if (action.length === 0 && !plan?.length) {
        return { run, bare: () => action() };
      }
      return { run };
    }
    const [Controller, method] = action;
    let controller = this.#controllers.get(Controller);
    if (!controller) {
      stampControllerConstructorInject(Controller, this.app);
      controller = this.app.make(Controller) as object;
      this.#controllers.set(Controller, controller);
    }
    const fn = (
      controller as Record<string, (...args: unknown[]) => unknown>
    )[method]!.bind(controller);

    const run = (request: Request) =>
      this.#resolveResult(
        this.#invokeController(fn, Controller, method, request, route),
        request,
      );
    if (fn.length === 0 && !route.inject?.length) {
      return { run, bare: () => fn() };
    }
    return { run };
  }

  #invokeController(
    fn: (...args: unknown[]) => unknown,
    Controller: ControllerClass,
    method: string,
    request: Request,
    route: RouteDefinition,
  ): unknown {
    const stamped = route.inject;
    const cached = stamped ?? getCachedControllerInjectPlan(Controller, method);
    if (cached !== undefined) {
      return this.#callWithPlan(fn, Controller, method, request, cached);
    }

    const resolved = resolveControllerInjectPlan(
      Controller,
      method,
      this.app,
      route.paramNames,
    );
    if (resolved instanceof Promise) {
      return resolved.then((plan) => {
        if (plan && !route.inject) route.inject = plan;
        return this.#callWithPlan(fn, Controller, method, request, plan);
      });
    }
    if (resolved && !route.inject) route.inject = resolved;
    return this.#callWithPlan(fn, Controller, method, request, resolved);
  }

  #callWithPlan(
    fn: (...args: unknown[]) => unknown,
    Controller: ControllerClass,
    method: string,
    request: Request,
    plan: InjectSlot[] | null,
  ): unknown {
    const needsForm = plan?.some((s) => s.kind === "form");
    if (!needsForm && plan && plan.length > 0) {
      return invokeWithInjectPlan(fn, plan, request);
    }

    // Legacy / form: resolve FormRequest (cached after first time).
    const Form = resolveFormRequest(Controller, method, this.app);
    if (Form instanceof Promise) {
      return Form.then((resolved) =>
        this.#finishFormCall(fn, resolved, request, plan),
      );
    }
    return this.#finishFormCall(fn, Form, request, plan);
  }

  #finishFormCall(
    fn: (...args: unknown[]) => unknown,
    Form: Awaited<ReturnType<typeof resolveFormRequest>>,
    request: Request,
    plan: InjectSlot[] | null,
  ): unknown {
    if (!Form) {
      return invokeWithInjectPlan(fn, plan, request);
    }
    return Form.from(request).then((form) =>
      invokeWithInjectPlan(fn, plan ?? [{ kind: "form" }], request, form),
    );
  }

  #routeDispatch(route: RouteDefinition): RouteDispatch {
    if (this.#lastRoute === route) return this.#lastDispatch!;
    const cached = this.#dispatchCache.get(route);
    if (cached) {
      this.#lastRoute = route;
      this.#lastDispatch = cached;
      return cached;
    }
    const dest = this.#actionDest(route);
    const stack = this.#resolvedStack(route);
    const prepared: RouteDispatch = {
      bind: this.app.router.hasBindings(route.paramNames),
      run: this.#wrapStack(stack, dest.run),
      bare: stack.length === 0 ? dest.bare : undefined,
    };
    this.#dispatchCache.set(route, prepared);
    this.#lastRoute = route;
    this.#lastDispatch = prepared;
    return prepared;
  }

  #dispatch(
    raw: globalThis.Request,
    pathname?: string,
  ): Response | Promise<Response> {
    const path = pathname ?? pathnameOf(raw.url);
    const methodResult = resolveRequestMethod(raw);
    if (methodResult instanceof Promise) {
      return methodResult.then((method) =>
        this.#dispatchWithMethod(raw, path, method),
      );
    }
    return this.#dispatchWithMethod(raw, path, methodResult);
  }

  #dispatchWithMethod(
    raw: globalThis.Request,
    path: string,
    method: string,
  ): Response | Promise<Response> {
    const matched = this.app.router.match(method, path);
    if (!matched) {
      const request = new Request(raw);
      if (method !== raw.method) request.setMethod(method);
      return this.#unmatched(request);
    }

    const prepared = this.#routeDispatch(matched.route);

    if (prepared.bare && !prepared.bind) {
      const request = new Request(raw, matched.params);
      request.routeName = matched.route.name;
      if (method !== raw.method) request.setMethod(method);
      return runWithPaginatorRequest(request, () => {
        try {
          const result = prepared.bare!();
          if (result instanceof Promise) {
            return result.then(
              (value) => this.#finishBare(value, raw, matched.params),
              (error) => this.#fail(error, request),
            );
          }
          return this.#finishBare(result, raw, matched.params);
        } catch (error) {
          return this.#fail(error, request);
        }
      });
    }

    const request = new Request(raw, matched.params);
    request.routeName = matched.route.name;
    if (method !== raw.method) request.setMethod(method);

    try {
      if (prepared.bind) {
        const bound = this.app.router.resolveBindings(request);
        if (bound) {
          return bound.then(
            () => this.#runPrepared(prepared, request),
            (error) => this.#fail(error, request),
          );
        }
      }
      return this.#runPrepared(prepared, request);
    } catch (error) {
      return this.#fail(error, request);
    }
  }

  /**
   * No route matched. Global middleware still runs, so CORS answers preflight `OPTIONS`
   * requests and adds its headers to 404 responses.
   */
  #unmatched(request: Request): Response | Promise<Response> {
    const global = this.app.getMiddleware();
    if (global.length === 0) return this.#fail(NOT_FOUND, request);
    if (this.#unmatchedFor !== global) {
      this.#unmatchedFor = global;
      this.#unmatchedRun = this.#wrapStack(global, () => {
        throw NOT_FOUND;
      });
    }
    return this.#runPrepared(
      { bind: false, run: this.#unmatchedRun! },
      request,
    );
  }

  #finishBare(
    result: unknown,
    raw: globalThis.Request,
    params: Record<string, string>,
  ): Response | Promise<Response> {
    if (result instanceof Response) {
      return this.#finalize(result, false);
    }
    const request = new Request(raw, params);
    try {
      const resolved = this.#resolveResult(result, request);
      if (resolved instanceof Promise) {
        return resolved.then(
          (response) => this.#finalize(response, false),
          (error) => this.#fail(error, request),
        );
      }
      return this.#finalize(resolved, false);
    } catch (error) {
      return this.#fail(error, request);
    }
  }

  #runPrepared(
    prepared: RouteDispatch,
    request: Request,
  ): Response | Promise<Response> {
    return runWithPaginatorRequest(request, () => {
      let result: Response | Promise<Response>;
      try {
        result = prepared.run(request);
      } catch (error) {
        return this.#fail(error, request);
      }
      if (result instanceof Promise) {
        return result.then(
          (response) => this.#finalize(response, false, request),
          (error) => this.#fail(error, request),
        );
      }
      return this.#finalize(result, false, request);
    });
  }

  #finalize(
    response: Response,
    failed: boolean,
    request?: Request,
  ): Response | Promise<Response> {
    failed ||= this.#failedResponses.has(response);
    if (request) response = addQueuedCookies(request, response);
    const flushed = flushDeferred(failed ? FLUSH_FAILED : undefined);
    return flushed ? flushed.then(() => response) : response;
  }

  #fail(
    error: unknown,
    request: Request,
  ): Response | Promise<Response> {
    const rendered = this.#errorResponse(error, request);
    if (rendered instanceof Promise) {
      return rendered.then((response) => this.#finalize(response, true, request));
    }
    return this.#finalize(rendered, true, request);
  }

  #errorResponse(
    error: unknown,
    request: Request,
  ): Response | Promise<Response> {
    notifyException(error, request);
    const renderers = this.app.exceptionRenderers();
    if (renderers.length === 0) {
      return this.#defaultErrorResponse(error, request);
    }
    return (async () => {
      for (const renderer of renderers) {
        const result = await renderer(error, request);
        if (result) return result;
      }
      return this.#defaultErrorResponse(error, request);
    })();
  }

  #defaultErrorResponse(
    error: unknown,
    request: Request,
  ): Response | Promise<Response> {
    if (error instanceof HttpResponseException) {
      return error.response;
    }
    if (error instanceof DdException) {
      return this.#ddResponse(error, request);
    }
    if (error instanceof ValidationException) {
      const accept = request.header("accept") ?? "";
      if (accept.includes("text/html") && request.session) {
        request.session.flash(
          "errors",
          error.errorBag === "default"
            ? error.errors
            : { [error.errorBag]: error.errors },
        );
        const old = { ...request.all() };
        for (const key of this.app.dontFlashKeys()) {
          delete old[key];
        }
        request.session.flash("_old", old);
        const back = request.header("referer") ?? "/";
        return redirect(back);
      }
      return json({ message: error.message, errors: error.errors }, 422);
    }
    return (async () => {
      const status = statusFromError(error);
      const shouldReport = await this.app.shouldReportException(error, status);
      const reportContext = shouldReport
        ? await this.app.exceptionReportContext(error)
        : undefined;
      return renderException(error, {
        request,
        debug: this.#isDebug(),
        appName: String(this.app.config.get("app.name", "Bunyad")),
        env: String(this.app.config.get("app.env", "local")),
        shouldRenderJsonWhen: this.app.shouldRenderJsonWhenCallback(),
        shouldReport,
        reportContext,
      });
    })();
  }

  async #ddResponse(
    error: DdException,
    request: Request,
  ): Promise<Response> {
    const values = await resolveDumpValues(error.values);
    if (
      shouldReturnJson(
        request,
        error,
        this.app.shouldRenderJsonWhenCallback(),
      )
    ) {
      return json({ dd: values }, 500);
    }
    return new Response(ddHtmlPage(values), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  #isDebug(): boolean {
    const configured = this.app.config.get("app.debug");
    if (typeof configured === "boolean") return configured;
    if (process.env.APP_DEBUG === "false" || process.env.APP_DEBUG === "0") {
      return false;
    }
    if (process.env.APP_DEBUG === "true" || process.env.APP_DEBUG === "1") {
      return true;
    }
    return process.env.NODE_ENV !== "production";
  }

  #resolveResult(
    result: unknown,
    request: Request,
  ): Response | Promise<Response> {
    if (result instanceof Promise) {
      return result.then((value) => this.#resolveResult(value, request));
    }
    if (result instanceof Response) return result;
    if (isResponsable(result)) return result.toResponse(request);
    if (typeof result === "string") {
      return new Response(result, HTML_OK);
    }
    if (typeof result === "number" || typeof result === "boolean") {
      return new Response(String(result), HTML_OK);
    }
    if (result == null) {
      return new Response("", HTML_OK);
    }
    // Collection / Model / Paginator — JSON.stringify invokes toJSON.
    if (typeof result === "object" && hasJsonSerialize(result)) {
      return json(result);
    }
    if (Array.isArray(result) || isPlainJsonObject(result)) {
      return json(result);
    }
    throw new TypeError(
      "Controller action must return a Response, string, JSON value, or JsonSerializable",
    );
  }
}

export function createFetchHandler(app: Application) {
  const kernel = new HttpKernel(app);
  return (request: globalThis.Request, pathname?: string) =>
    kernel.handle(request, pathname);
}
