import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseRouteParamSegment,
  looksLikeStringEnum,
  type BindableModel,
  type InjectSlot,
  type Router,
} from "./router.ts";

export type ActionParamInfo = {
  name: string;
  typeName?: string;
};

/** Parse `(req: Request, user: User)` / `(user: User)` style parameter lists. */
export function parseActionParams(paramsSource: string): ActionParamInfo[] {
  const trimmed = paramsSource.trim();
  if (!trimmed) return [];
  const out: ActionParamInfo[] = [];
  for (const part of trimmed.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const m = /^([A-Za-z_][\w]*)\s*(?::\s*([A-Za-z_][\w]*))?/.exec(piece);
    if (!m) continue;
    out.push({ name: m[1]!, typeName: m[2] });
  }
  return out;
}

const CTOR_MODIFIER = /^(?:private|protected|public|readonly|override|abstract)\s+/;

/**
 * Parse constructor parameter lists, including parameter properties
 * (`private $guideSteps: GuideStepsService`).
 */
export function parseConstructorParams(paramsSource: string): ActionParamInfo[] {
  const trimmed = paramsSource.trim();
  if (!trimmed) return [];
  const out: ActionParamInfo[] = [];
  for (const part of trimmed.split(",")) {
    let piece = part.trim();
    if (!piece || piece.startsWith("...")) continue;
    while (CTOR_MODIFIER.test(piece)) {
      piece = piece.replace(CTOR_MODIFIER, "");
    }
    const m =
      /^([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_][\w]*))?/.exec(piece);
    if (!m) continue;
    out.push({ name: m[1]!, typeName: m[2] });
  }
  return out;
}

/** Constructor params for `className` in a source file (first constructor if unnamed). */
export function constructorParamsFromSource(
  source: string,
  className?: string,
): ActionParamInfo[] {
  let region = source;
  if (className) {
    const re = new RegExp(
      String.raw`(?:export\s+default\s+)?class\s+${className}\b`,
    );
    const start = re.exec(source);
    if (!start) return [];
    const rest = source.slice(start.index + 1);
    const next = rest.search(/\n(?:export\s+)?(?:default\s+)?class\s+/);
    region =
      next === -1
        ? source.slice(start.index)
        : source.slice(start.index, start.index + 1 + next);
  }
  const ctor = /constructor\s*\(([^)]*)\)/.exec(region);
  if (!ctor) return [];
  return parseConstructorParams(ctor[1] ?? "");
}

export type TypeImportInfo = {
  spec: string;
  exportName: string;
  typeOnly: boolean;
};

/** Named/default import used for `typeName`, if any. */
export function importInfoForType(
  source: string,
  typeName: string,
): TypeImportInfo | null {
  const re =
    /import\s+(type\s+)?(?:\{([^}]+)\}|([A-Za-z_][\w]*))\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const typeOnly = Boolean(match[1]);
    const spec = match[4]!;
    const defaultName = match[3];
    if (defaultName === typeName) {
      return { spec, exportName: "default", typeOnly };
    }
    const names = match[2];
    if (!names) continue;
    for (const part of names.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const bits = trimmed.replace(/^type\s+/, "").split(/\s+as\s+/);
      const imported = bits[0]?.trim();
      const local = (bits[1] ?? imported)?.trim();
      if (local === typeName || imported === typeName) {
        return {
          spec,
          exportName: imported || typeName,
          typeOnly: typeOnly || /^\s*type\s+/.test(trimmed),
        };
      }
    }
  }
  return null;
}

function studly(name: string): string {
  return name
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function paramForType(
  typeName: string,
  argName: string,
  routeParams: readonly string[],
): string | null {
  if (routeParams.includes(argName)) return argName;
  const fromType =
    typeName.charAt(0).toLowerCase() + typeName.slice(1);
  if (routeParams.includes(fromType)) return fromType;
  if (routeParams.includes(typeName.toLowerCase())) {
    return typeName.toLowerCase();
  }
  return routeParams.includes(argName) ? argName : fromType;
}

function isRequestTypeName(typeName: string | undefined, argName: string): boolean {
  if (typeName === "Request") return true;
  if (!typeName) {
    return argName === "req" || argName === "request" || argName === "_req";
  }
  return false;
}

function isFormRequestTypeName(typeName: string | undefined): boolean {
  return Boolean(typeName && typeName !== "Request" && typeName.endsWith("Request"));
}

function looksLikeBindableModel(value: unknown): value is BindableModel {
  return (
    typeof value === "function" &&
    typeof (value as { find?: unknown }).find === "function"
  );
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

async function resolveCtor(
  source: string,
  filePath: string,
  typeName: string,
): Promise<unknown | null> {
  const spec = importSpecifier(source, typeName);
  if (!spec) return null;
  // `import type` only — no runtime binding available.
  const typeOnly = new RegExp(
    String.raw`import\s+type\s+(?:\{[^}]*\b${typeName}\b[^}]*\}|${typeName})\s+from`,
  );
  if (typeOnly.test(source) && !new RegExp(
    String.raw`import\s+(?!type)(?:\{[^}]*\b${typeName}\b[^}]*\}|${typeName})\s+from`,
  ).test(source)) {
    return null;
  }
  let resolved: string;
  try {
    resolved = Bun.resolveSync(spec, dirname(filePath));
  } catch {
    return null;
  }
  const mod = (await import(pathToFileURL(resolved).href)) as Record<
    string,
    unknown
  >;
  return mod[typeName] ?? mod.default ?? null;
}

function slotsFromParams(
  params: ActionParamInfo[],
  routeParams: readonly string[],
  modelTypes: Map<string, string>,
): InjectSlot[] {
  const slots: InjectSlot[] = [];
  const usedRouteParams = new Set<string>();
  for (const param of params) {
    if (isRequestTypeName(param.typeName, param.name)) {
      slots.push({ kind: "request" });
      continue;
    }
    if (isFormRequestTypeName(param.typeName)) {
      slots.push({ kind: "form" });
      continue;
    }
    if (param.typeName && modelTypes.has(param.typeName)) {
      const routeParam =
        paramForType(param.typeName, param.name, routeParams) ??
        modelTypes.get(param.typeName)!;
      usedRouteParams.add(routeParam);
      slots.push({ kind: "model", param: routeParam });
      continue;
    }
    // `{id}` + `$id` → route parameter value (string), not Request.
    if (routeParams.includes(param.name)) {
      usedRouteParams.add(param.name);
      slots.push({ kind: "param", param: param.name });
      continue;
    }
    // `array_values($route->parameters())`: untyped args receive route
    // values in URI order when names do not match (e.g. `{user}` + `($id)`).
    if (!param.typeName) {
      const next = routeParams.find((name) => !usedRouteParams.has(name));
      if (next) {
        usedRouteParams.add(next);
        slots.push({ kind: "param", param: next });
        continue;
      }
      slots.push({ kind: "request" });
    }
  }
  return slots;
}

/**
 * One-shot scan of a route module source: register model binders from typed
 * closures and stamp `inject` plans. Never call on the request path.
 */
export async function applyRouteFileBindings(
  router: Router,
  filePath: string,
  source?: string,
): Promise<void> {
  const text = source ?? (await Bun.file(filePath).text());
  const verbRe =
    /Route\.(get|post|put|patch|delete|options|any|match)\s*\(\s*(?:\[([^\]]*)\]\s*,\s*)?(['"`])([^'"`]+)\3\s*,\s*(?:async\s*)?\(([^)]*)\)/g;

  type ClosureHit = {
    uri: string;
    params: ActionParamInfo[];
  };
  const hits: ClosureHit[] = [];
  let match: RegExpExecArray | null;
  while ((match = verbRe.exec(text))) {
    const uri = match[4]!;
    const params = parseActionParams(match[5] ?? "");
    if (params.length === 0) continue;
    const routeParams = extractParamNames(uri);
    const hasModelType = params.some(
      (p) => p.typeName && p.typeName !== "Request" && !isFormRequestTypeName(p.typeName),
    );
    // Include untyped `(id)` when the name matches `{id}`, or when names differ
    // but route params exist.
    const hasRouteParamArg = params.some((p) => routeParams.includes(p.name));
    const hasPositionalScalar = params.some(
      (p) =>
        !p.typeName &&
        !isRequestTypeName(undefined, p.name) &&
        routeParams.length > 0,
    );
    if (hasModelType || hasRouteParamArg || hasPositionalScalar) {
      hits.push({ uri, params });
    }
  }

  if (hits.length === 0) {
    return;
  }

  const modelTypes = new Map<string, string>(); // typeName → route param
  for (const hit of hits) {
    const routeParams = extractParamNames(hit.uri);
    for (const p of hit.params) {
      if (!p.typeName || isRequestTypeName(p.typeName, p.name)) continue;
      if (isFormRequestTypeName(p.typeName)) continue;
      const routeParam = paramForType(p.typeName, p.name, routeParams);
      if (!routeParam) continue;
      if (modelTypes.has(p.typeName)) continue;
      // Prefer registering from the route file import; convention covers the rest.
      const ctor = await resolveCtor(text, filePath, p.typeName);
      if (looksLikeBindableModel(ctor)) {
        router.modelIfAbsent(routeParam, ctor);
        modelTypes.set(p.typeName, routeParam);
      } else if (looksLikeStringEnum(ctor)) {
        router.enumIfAbsent(routeParam, ctor);
        modelTypes.set(p.typeName, routeParam);
      } else {
        modelTypes.set(p.typeName, routeParam);
      }
    }
  }

  for (const route of router.routes) {
    if (typeof route.action !== "function" || route.inject) continue;
    const hit = hits.find((h) => normalizeUri(h.uri) === route.uri);
    if (!hit) continue;
    const slots = slotsFromParams(hit.params, route.paramNames, modelTypes);
    if (slots.length > 0) {
      router.setInject(route, slots);
    }
  }
}

function extractParamNames(uri: string): string[] {
  const names: string[] = [];
  for (const segment of uri.split("/")) {
    if (segment.startsWith("{") && segment.endsWith("}")) {
      const { name } = parseRouteParamSegment(segment.slice(1, -1));
      names.push(name);
    }
  }
  return names;
}

function normalizeUri(uri: string): string {
  if (uri === "" || uri === "/") return "/";
  const withSlash = uri.startsWith("/") ? uri : `/${uri}`;
  return withSlash.length > 1 && withSlash.endsWith("/")
    ? withSlash.slice(0, -1)
    : withSlash;
}

/**
 * Convention binders should not run for params that every planned route only
 * injects as a raw URI segment.
 */
function paramNeedsModelBinder(router: Router, param: string): boolean {
  for (const route of router.routes) {
    if (!route.paramNames.includes(param)) continue;
    if (!route.inject) {
      // Bare / controller-not-yet-stamped — keep name→Model convention.
      return true;
    }
    for (const slot of route.inject) {
      if (slot.kind === "model" && slot.param === param) return true;
    }
  }
  return false;
}

/**
 * Boot-time convention: for unbound route params, load `app/Models/{Studly}`.
 * Never call on the request path.
 */
export async function registerConventionModels(
  router: Router,
  modelsRoot: string,
): Promise<void> {
  const needed = new Set<string>();
  for (const route of router.routes) {
    for (const param of route.paramNames) {
      if (router.hasBinder(param)) continue;
      if (!paramNeedsModelBinder(router, param)) continue;
      needed.add(param);
    }
  }
  if (needed.size === 0) return;

  for (const param of needed) {
    const className = studly(param);
    for (const ext of [".ts", ".tsx", ".js"]) {
      const file = join(modelsRoot, `${className}${ext}`);
      if (!(await Bun.file(file).exists())) continue;
      try {
        const mod = (await import(pathToFileURL(file).href)) as Record<
          string,
          unknown
        >;
        const ctor = mod.default ?? mod[className];
        if (looksLikeBindableModel(ctor)) {
          router.modelIfAbsent(param, ctor);
        }
      } catch {
        // Missing / invalid model — leave unbound.
      }
      break;
    }
  }
}
