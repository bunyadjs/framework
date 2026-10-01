import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  isFormRequestCtor,
  type FormRequestCtor,
  type Request,
} from "@bunyad/http";
import type { InjectSlot, RouteDefinition } from "@bunyad/router";
import { parseActionParams, looksLikeStringEnum } from "@bunyad/router";
import type { Application } from "./application.ts";
import { isCompiledBootMode } from "./compiled-boot.ts";
import { BunyadError } from "@bunyad/common";

const FORM = Symbol.for("bunyad.formRequest");
const INJECT = Symbol.for("bunyad.injectPlan");

type ActionFn = ((...args: unknown[]) => unknown) & {
  [FORM]?: FormRequestCtor;
  [INJECT]?: InjectSlot[];
};

const planCache = new WeakMap<Function, Map<string, InjectSlot[] | null>>();
/**
 * Source file per controller class. Keyed by the class, not its name: two
 * controllers may share a name (`UserController` and `Admin/UserController`,
 * or two apps in one process).
 */
const controllerFiles = new WeakMap<Function, string>();

/** Production / compiled: never Bun.Glob for missing inject plans. */
export function shouldFailClosedOnMissingInjectPlan(basePath?: string): boolean {
  if (process.env.BUNYAD_DEV === "1" || process.env.BUNYAD_HOT === "1") {
    return false;
  }
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.BUNYAD_COMPILED === "1") return true;
  return isCompiledBootMode(basePath);
}


/** Call `fn` using a precomputed inject plan (hot path — no classification). */
export function invokeWithInjectPlan(
  fn: (...args: unknown[]) => unknown,
  plan: InjectSlot[] | null | undefined,
  request: Request,
  form?: unknown,
): unknown {
  if (!plan || plan.length === 0) {
    return fn(form ?? request);
  }
  if (plan.length === 1) {
    return fn(resolveInjectSlot(plan[0]!, request, form));
  }
  const args: unknown[] = [];
  for (let i = 0; i < plan.length; i++) {
    args.push(resolveInjectSlot(plan[i]!, request, form));
  }
  return fn(...args);
}

function resolveInjectSlot(
  slot: InjectSlot,
  request: Request,
  form?: unknown,
): unknown {
  if (slot.kind === "request") return request;
  if (slot.kind === "form") return form ?? request;
  if (slot.kind === "model") return request.model(slot.param);
  // Prefer substituted model when a binder ran (Laravel SubstituteBindings).
  const bound = request.model(slot.param);
  if (bound !== undefined && bound !== null) return bound;
  return request.route(slot.param);
}

/** Prefer stamped route.inject; else cached controller plan. */
export function injectPlanForRoute(
  route: RouteDefinition,
): InjectSlot[] | null | undefined {
  return route.inject;
}

export function getCachedControllerInjectPlan(
  Controller: Function,
  method: string,
): InjectSlot[] | null | undefined {
  const cached = planCache.get(Controller)?.get(method);
  return cached;
}

export function setControllerInjectPlan(
  Controller: Function,
  method: string,
  plan: InjectSlot[] | null,
): void {
  let methods = planCache.get(Controller);
  if (!methods) {
    methods = new Map();
    planCache.set(Controller, methods);
  }
  methods.set(method, plan);
  const fn = (Controller as { prototype: Record<string, ActionFn> }).prototype[
    method
  ];
  if (typeof fn === "function") {
    fn[INJECT] = plan ?? undefined;
  }
}

/**
 * Resolve controller inject plan once (may hit disk on first resolve only).
 * Result is cached for the process lifetime.
 */
export function resolveControllerInjectPlan(
  Controller: Function,
  method: string,
  app: Application,
  routeParams: readonly string[],
): InjectSlot[] | null | Promise<InjectSlot[] | null> {
  const cached = planCache.get(Controller)?.get(method);
  if (cached !== undefined) return cached;

  const fn = (Controller as { prototype: Record<string, ActionFn> }).prototype[
    method
  ];
  if (typeof fn !== "function") {
    setControllerInjectPlan(Controller, method, null);
    return null;
  }
  if (fn[INJECT]) {
    setControllerInjectPlan(Controller, method, fn[INJECT]);
    return fn[INJECT];
  }

  if (shouldFailClosedOnMissingInjectPlan(app.basePath())) {
    throw new BunyadError(
      `Missing inject plan for ${Controller.name}.${method} in production/compiled mode. ` +
        `Stamp plans at boot/compile (or set BUNYAD_DEV=1); disk Glob is disabled.`,
      "BUNYAD_INJECT_001",
    );
  }

  return fromControllerSource(Controller, method, app, routeParams).then(
    (plan) => {
      setControllerInjectPlan(Controller, method, plan);
      return plan;
    },
  );
}

/** FormRequest ctor for the form slot, if any. */
export function formCtorFromPlan(
  plan: InjectSlot[] | null | undefined,
  Controller: Function,
  method: string,
): FormRequestCtor | null {
  if (!plan?.some((s) => s.kind === "form")) return null;
  const fn = (Controller as { prototype: Record<string, ActionFn> }).prototype[
    method
  ];
  if (typeof fn === "function" && isFormRequestCtor(fn[FORM])) {
    return fn[FORM];
  }
  return null;
}

async function fromControllerSource(
  Controller: Function,
  method: string,
  app: Application,
  routeParams: readonly string[],
): Promise<InjectSlot[] | null> {
  const file = await controllerSourceFile(Controller, app, method);
  if (!file) return null;
  const source = await Bun.file(file).text();
  const params = actionParams(source, method);
  if (params.length === 0) return null;

  const modelTypes = new Map<string, string>();
  for (const p of params) {
    if (!p.typeName || p.typeName === "Request") continue;
    if (p.typeName.endsWith("Request") && p.typeName !== "Request") continue;
    const routeParam = mapParam(p.typeName, p.name, routeParams);
    if (!routeParam) continue;
    // Ensure binder exists (boot-time convention for controllers).
    if (!app.router.hasBinder(routeParam)) {
      const ctor = await resolveImportedCtor(source, file, p.typeName);
      if (isBindable(ctor)) {
        app.router.modelIfAbsent(routeParam, ctor);
        modelTypes.set(p.typeName, routeParam);
      } else if (looksLikeStringEnum(ctor)) {
        app.router.enumIfAbsent(routeParam, ctor);
        modelTypes.set(p.typeName, routeParam);
      }
    } else {
      modelTypes.set(p.typeName, routeParam);
    }
  }

  const slots: InjectSlot[] = [];
  const usedRouteParams = new Set<string>();
  for (const p of params) {
    if (p.typeName === "Request" || (!p.typeName && isRequestArgName(p.name))) {
      slots.push({ kind: "request" });
      continue;
    }
    if (p.typeName && p.typeName !== "Request" && p.typeName.endsWith("Request")) {
      slots.push({ kind: "form" });
      continue;
    }
    if (p.typeName && modelTypes.has(p.typeName)) {
      const routeParam = modelTypes.get(p.typeName)!;
      usedRouteParams.add(routeParam);
      slots.push({
        kind: "model",
        param: routeParam,
      });
      continue;
    }
    // Laravel: route parameter name match → scalar (or bound model at invoke).
    if (routeParams.includes(p.name)) {
      usedRouteParams.add(p.name);
      slots.push({ kind: "param", param: p.name });
      continue;
    }
    // Laravel positional: `{user}` + `($id)` → inject the URI segment string.
    if (!p.typeName) {
      const next = routeParams.find((name) => !usedRouteParams.has(name));
      if (next) {
        usedRouteParams.add(next);
        slots.push({ kind: "param", param: next });
        continue;
      }
      slots.push({ kind: "request" });
    }
  }
  return slots.length > 0 ? slots : null;
}

function isRequestArgName(name: string): boolean {
  return name === "req" || name === "request" || name === "_req";
}

function mapParam(
  typeName: string,
  argName: string,
  routeParams: readonly string[],
): string | null {
  if (routeParams.includes(argName)) return argName;
  const fromType = typeName.charAt(0).toLowerCase() + typeName.slice(1);
  if (routeParams.includes(fromType)) return fromType;
  if (routeParams.includes(typeName.toLowerCase())) {
    return typeName.toLowerCase();
  }
  return routeParams.length === 1 ? routeParams[0]! : fromType;
}

function isBindable(
  value: unknown,
): value is { find(id: string | number): unknown } {
  return (
    typeof value === "function" &&
    typeof (value as { find?: unknown }).find === "function"
  );
}

async function resolveImportedCtor(
  source: string,
  file: string,
  typeName: string,
): Promise<unknown | null> {
  const spec = importSpecifier(source, typeName);
  if (!spec) {
    // Same-file export
    const mod = (await import(file)) as Record<string, unknown>;
    return mod[typeName] ?? null;
  }
  let resolved: string;
  try {
    resolved = Bun.resolveSync(spec, dirname(file));
  } catch {
    return null;
  }
  const mod = (await import(resolved)) as Record<string, unknown>;
  return mod[typeName] ?? mod.default ?? null;
}

async function controllerSourceFile(
  Controller: Function,
  app: Application,
  method: string,
): Promise<string | null> {
  const name = Controller.name;
  if (!name) return null;
  const cached = controllerFiles.get(Controller);
  if (cached) return cached;

  const controllers = app.path("Http/Controllers");
  const roots = [controllers, app.basePath()];
  const candidates: string[] = [];
  for (const root of roots) {
    for (const ext of [".ts", ".js"]) {
      const file = join(root, `${name}${ext}`);
      if (existsSync(file)) candidates.push(file);
    }
  }
  // Dev-only: recursive Glob. Production/compiled must never scan disk here.
  if (!shouldFailClosedOnMissingInjectPlan(app.basePath())) {
    // Same-named controllers in subfolders compete with a top-level match.
    const scan = candidates.length > 0 ? [controllers] : roots;
    for (const root of scan) {
      if (!existsSync(root)) continue;
      const glob = new Bun.Glob(`**/${name}.{ts,js}`);
      for await (const file of glob.scan({ cwd: root, absolute: true })) {
        if (!candidates.includes(file)) candidates.push(file);
      }
    }
  }

  const file = pickControllerFile(candidates, Controller, method);
  if (file) controllerFiles.set(Controller, file);
  return file;
}

/** Among files named like the class, the one whose `method` takes the same parameters. */
function pickControllerFile(
  candidates: string[],
  Controller: Function,
  method: string,
): string | null {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const fn = (Controller as { prototype: Record<string, unknown> }).prototype[method];
  const runtime = typeof fn === "function" ? runtimeParamNames(fn) : [];
  const matches = candidates.find((file) => {
    const names = actionParams(readFileSync(file, "utf8"), method).map((p) => p.name);
    return names.length === runtime.length && names.every((n, i) => n === runtime[i]);
  });
  return matches ?? candidates[0]!;
}

/** Parameter names from a method's runtime source (types are already stripped). */
function runtimeParamNames(fn: Function): string[] {
  const list = /^[^(]*\(([^)]*)\)/.exec(fn.toString())?.[1] ?? "";
  return list
    .split(",")
    .map((part) => part.split(/[=:]/)[0]!.trim())
    .filter(Boolean);
}

function actionParams(
  source: string,
  method: string,
): ReturnType<typeof parseActionParams> {
  const re = new RegExp(
    String.raw`(?:public|protected|private|async|static|\s)+${method}\s*\(([^)]*)\)`,
  );
  const m = re.exec(source);
  if (!m) return [];
  return parseActionParams(m[1] ?? "");
}

function importSpecifier(source: string, typeName: string): string | null {
  const re =
    /import\s+(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z_][\w]*))\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const spec = match[3]!;
    const defaultName = match[2];
    if (defaultName === typeName) return spec;
    const names = match[1];
    if (!names) continue;
    for (const part of names.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const bits = trimmed.replace(/^type\s+/, "").split(/\s+as\s+/);
      const imported = bits[0]?.trim();
      const local = (bits[1] ?? imported)?.trim();
      if (local === typeName || imported === typeName) return spec;
    }
  }
  return null;
}
