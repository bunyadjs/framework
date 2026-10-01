import { BunyadError } from "@bunyad/common";
import { middlewareAliasOf } from "@bunyad/http";
import { dirname, join } from "node:path";
import {
  Route,
  loadRouteModule,
  getDefaultRouter,
  setActiveRouter,
  parseActionParams,
  constructorParamsFromSource,
  importInfoForType,
  type InjectSlot,
  type RouteDefinition,
} from "@bunyad/router";
import type { RouteDeclaration } from "@bunyad/router";
import type {
  AnalyzeContext,
  CompilerPlugin,
  GenerateContext,
} from "../types.ts";

type ControllerIR = {
  module: string;
  exportName: string;
  className: string;
  method: string;
};

type ModelIR = {
  param: string;
  module: string;
  exportName: string;
  className: string;
};

type RouteIR = {
  methods: string[];
  uri: string;
  name?: string;
  middleware: string[];
  wheres: Record<string, string>;
  /** A controller action, or a helper route (`Route.view` / `Route.redirect` / `Inertia.route`). */
  controller?: ControllerIR;
  declaration?: RouteDeclaration;
  /** Precomputed inject plan stamped onto compiled routes (no request-path Glob). */
  inject: InjectSlot[];
};

type ConstructorDepIR = {
  className: string;
  module: string;
  exportName: string;
};

type RouterIR = {
  routes: RouteIR[];
  models: ModelIR[];
  entries: string[];
  constructorInject: Record<string, ConstructorDepIR[]>;
};

function relativeImport(fromFile: string, toFile: string): string {
  const fromParts = fromFile.replace(/\\/g, "/").split("/");
  const toParts = toFile.replace(/\\/g, "/").split("/");
  let i = 0;
  while (
    i < fromParts.length - 1 &&
    i < toParts.length - 1 &&
    fromParts[i] === toParts[i]
  ) {
    i++;
  }
  const ups = fromParts.length - 1 - i;
  return `${"../".repeat(ups)}${toParts.slice(i).join("/")}`;
}

const SKIP_CTOR_TYPES = new Set([
  "Request",
  "String",
  "Number",
  "Boolean",
  "Object",
  "Array",
  "Date",
  "Promise",
  "Function",
]);

function isInjectableCtorType(typeName: string | undefined): typeName is string {
  if (!typeName) return false;
  if (!/^[A-Z]/.test(typeName)) return false;
  return !SKIP_CTOR_TYPES.has(typeName);
}

async function constructorDepsFromSource(
  source: string,
  file: string,
  className: string,
): Promise<ConstructorDepIR[]> {
  if (/\bstatic\s+inject\s*=/.test(source)) return [];
  const params = constructorParamsFromSource(source, className);
  const deps: ConstructorDepIR[] = [];
  for (const param of params) {
    if (!isInjectableCtorType(param.typeName)) continue;
    const info = importInfoForType(source, param.typeName);
    if (!info || info.typeOnly) continue;
    let resolved: string;
    try {
      if (info.spec.startsWith("./") || info.spec.startsWith("../")) {
        resolved = join(dirname(file), info.spec);
      } else {
        resolved = Bun.resolveSync(info.spec, file);
      }
    } catch {
      continue;
    }
    deps.push({
      className: param.typeName,
      module: resolved,
      exportName: info.exportName,
    });
  }
  return deps;
}

function controllerMethodParams(
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

async function mapDefaultExports(
  root: string,
  pattern: string,
): Promise<Map<Function, { module: string; exportName: string }>> {
  const map = new Map<Function, { module: string; exportName: string }>();
  const glob = new Bun.Glob(pattern);
  for await (const file of glob.scan({ cwd: root, absolute: true })) {
    const mod = await import(file);
    if (typeof mod.default === "function") {
      map.set(mod.default, { module: file, exportName: "default" });
    }
  }
  return map;
}

/**
 * Map controllers exported from app `package.json` dependencies (e.g. Metrics /
 * Package controllers registered via `Metrics.routes()`).
 */
/** Survives a JSON round trip unchanged, so it can be written into generated code. */
function isPlainData(value: unknown): boolean {
  try {
    return Bun.deepEquals(JSON.parse(JSON.stringify(value)), value);
  } catch {
    return false;
  }
}

async function mapDependencyControllers(
  root: string,
): Promise<Map<Function, { module: string; exportName: string }>> {
  const map = new Map<Function, { module: string; exportName: string }>();
  const pkgPath = `${root.replace(/\\/g, "/")}/package.json`;
  if (!(await Bun.file(pkgPath).exists())) return map;

  const pkg = (await Bun.file(pkgPath).json()) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  for (const name of Object.keys(deps)) {
    // Prefer package-of-origin over umbrella re-exports (e.g. @bunyad/framework).
    if (name === "@bunyad/framework") continue;
    let modulePath: string;
    try {
      modulePath = Bun.resolveSync(name, root);
    } catch {
      continue;
    }
    try {
      const mod = await import(modulePath);
      for (const [exportName, value] of Object.entries(mod)) {
        if (typeof value !== "function") continue;
        // Prefer first binding; app controllers already win in the merged map.
        if (!map.has(value as Function)) {
          map.set(value as Function, { module: name, exportName });
        }
      }
    } catch {
      // Optional / unloadable dependency — skip.
    }
  }
  return map;
}

function toImportSpecifier(fromFile: string, module: string): string {
  // Package name (`@bunyad/metrics`) or bare specifier — keep as-is.
  if (
    module.startsWith("@") ||
    (!module.startsWith("/") &&
      !module.startsWith(".") &&
      !/^[A-Za-z]:[\\/]/.test(module))
  ) {
    return module;
  }
  return relativeImport(fromFile, module);
}

function controllerImportLine(
  className: string,
  exportName: string,
  specifier: string,
): string {
  if (exportName === "default") {
    return `import ${className} from "${specifier}";`;
  }
  if (exportName === className) {
    return `import { ${className} } from "${specifier}";`;
  }
  return `import { ${exportName} as ${className} } from "${specifier}";`;
}

function verbFn(method: string): string {
  switch (method) {
    case "GET":
      return "get";
    case "POST":
      return "post";
    case "PUT":
      return "put";
    case "PATCH":
      return "patch";
    case "DELETE":
      return "delete";
    default:
      return "any";
  }
}

function collectMiddlewareAliases(
  route: RouteDefinition,
  entry: string,
  diagnostics: AnalyzeContext["diagnostics"],
): string[] {
  const aliases: string[] = [];
  for (const mw of route.middleware) {
    const alias = middlewareAliasOf(mw);
    if (!alias) {
      diagnostics.push({
        code: "BUNYAD_ROUTE_012",
        message: `Route [${route.uri}] has middleware without a Laravel alias; use string middleware (e.g. "auth") or tagged factories (auth(), throttle("api"), can("delete", "post")).`,
        file: entry,
      });
      continue;
    }
    aliases.push(alias);
  }
  return aliases;
}


function isRequestArgName(name: string): boolean {
  return name === "req" || name === "request" || name === "_req";
}

function mapInjectRouteParam(
  typeName: string,
  argName: string,
  routeParams: readonly string[],
): string {
  if (routeParams.includes(argName)) return argName;
  const fromType = typeName.charAt(0).toLowerCase() + typeName.slice(1);
  if (routeParams.includes(fromType)) return fromType;
  if (routeParams.includes(typeName.toLowerCase())) {
    return typeName.toLowerCase();
  }
  return routeParams.length === 1 ? routeParams[0]! : fromType;
}

function injectSlotsFromParams(
  params: ReturnType<typeof parseActionParams>,
  routeParams: readonly string[],
  modelClassNames: ReadonlySet<string>,
): InjectSlot[] {
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
    if (p.typeName && modelClassNames.has(p.typeName)) {
      const routeParam = mapInjectRouteParam(p.typeName, p.name, routeParams);
      usedRouteParams.add(routeParam);
      slots.push({
        kind: "model",
        param: routeParam,
      });
      continue;
    }
    if (routeParams.includes(p.name)) {
      usedRouteParams.add(p.name);
      slots.push({ kind: "param", param: p.name });
      continue;
    }
    // Laravel positional: `{user}` + `($id)` → raw URI segment.
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
  return slots;
}

async function readModuleSource(
  module: string,
  root: string,
): Promise<string | null> {
  const tryRead = async (file: string): Promise<string | null> => {
    try {
      return await Bun.file(file).text();
    } catch {
      return null;
    }
  };
  if (
    module.startsWith("/") ||
    module.startsWith(".") ||
    /^[A-Za-z]:[\\/]/.test(module)
  ) {
    return tryRead(module);
  }
  try {
    const resolved = Bun.resolveSync(module, root);
    return tryRead(resolved);
  } catch {
    return null;
  }
}

function serializeInjectSlots(slots: InjectSlot[]): string {
  return `[${slots
    .map((s) => {
      if (s.kind === "model" || s.kind === "param") {
        return `{ kind: ${JSON.stringify(s.kind)}, param: ${JSON.stringify(s.param)} }`;
      }
      return `{ kind: ${JSON.stringify(s.kind)} }`;
    })
    .join(", ")}]`;
}

export function createRouterPlugin(options: {
  /** @deprecated Prefer `routesEntries`. */
  routesEntry?: string;
  /** Absolute paths to route modules (side-effect Route.*, default export, or registerRoutes BC). */
  routesEntries?: string[];
  /** Append `router.optimize()` for radix matching. */
  optimize?: boolean;
}): CompilerPlugin {
  const entries = options.routesEntries?.length
    ? options.routesEntries
    : options.routesEntry
      ? [options.routesEntry]
      : [];
  const optimize = options.optimize === true;

  return {
    name: "router",

    async analyze(ctx: AnalyzeContext) {
      if (entries.length === 0) {
        ctx.diagnostics.push({
          code: "BUNYAD_ROUTE_001",
          message: "No route entries provided to the router compiler plugin.",
        });
        return;
      }

      // Ensure default middleware aliases are registered for introspection.
      await import("@bunyad/auth");
      await import("@bunyad/http");

      const target = getDefaultRouter();
      setActiveRouter(target);
      target.clear();
      for (const entry of entries) {
        try {
          await loadRouteModule(entry, target);
        } catch (err) {
          ctx.diagnostics.push({
            code: "BUNYAD_ROUTE_013",
            message:
              err instanceof Error
                ? err.message
                : `Failed to load route entry: ${entry}`,
            file: entry,
          });
        }
      }

      const controllers = await mapDefaultExports(
        ctx.root,
        "app/Http/Controllers/**/*.{ts,tsx,js}",
      );
      const packageControllers = await mapDependencyControllers(ctx.root);
      for (const [ctor, info] of packageControllers) {
        if (!controllers.has(ctor)) controllers.set(ctor, info);
      }
      const models = await mapDefaultExports(
        ctx.root,
        "app/Models/**/*.{ts,tsx,js}",
      );

      const routes: RouteIR[] = [];
      const constructorInject: Record<string, ConstructorDepIR[]> = {};
      const stampedControllers = new Set<Function>();
      const primaryEntry = entries[0]!;

      for (const route of Route.routes) {
        // Helper routes are closures at runtime, but say what they do; register them again.
        if (!Array.isArray(route.action) && route.declaration && isPlainData(route.declaration)) {
          routes.push({
            methods: route.methods.filter((m) => m !== "HEAD"),
            uri: route.uri,
            name: route.name,
            middleware: collectMiddlewareAliases(route, primaryEntry, ctx.diagnostics),
            wheres: { ...route.wheres },
            declaration: route.declaration,
            inject: [],
          });
          continue;
        }
        if (!Array.isArray(route.action)) {
          ctx.diagnostics.push({
            code: "BUNYAD_ROUTE_010",
            severity: "warning",
            message: `Route [${route.uri}] uses a closure and was skipped; compile requires [Controller, method].`,
            file: primaryEntry,
          });
          continue;
        }

        const [Controller, method] = route.action as [
          new () => object,
          string,
        ];
        const found = controllers.get(Controller);
        if (!found) {
          ctx.diagnostics.push({
            code: "BUNYAD_ROUTE_011",
            message: `Controller for route [${route.uri}] not found under app/Http/Controllers or package exports.`,
            file: primaryEntry,
          });
          continue;
        }

        const middleware = collectMiddlewareAliases(
          route,
          primaryEntry,
          ctx.diagnostics,
        );

        // Inject plan from controller signature (compile-time; no request Glob).
        let inject: InjectSlot[] = [];
        const source = await readModuleSource(found.module, ctx.root);
        if (source) {
          const paramList = controllerMethodParams(source, method);
          const modelNames = new Set<string>();
          for (const ctor of models.keys()) {
            modelNames.add((ctor as { name: string }).name);
          }
          inject = injectSlotsFromParams(paramList, route.paramNames, modelNames);
          if (!stampedControllers.has(Controller)) {
            stampedControllers.add(Controller);
            const deps = await constructorDepsFromSource(
              source,
              found.module,
              Controller.name,
            );
            if (deps.length > 0) {
              constructorInject[Controller.name] = deps;
            }
          }
        }

        routes.push({
          methods: route.methods.filter((m) => m !== "HEAD"),
          uri: route.uri,
          name: route.name,
          middleware,
          wheres: { ...route.wheres },
          controller: {
            module: found.module,
            exportName: found.exportName,
            className: Controller.name,
            method,
          },
          inject,
        });
      }

      const modelIR: ModelIR[] = [];
      const seenModelParams = new Set<string>();

      for (const [param, model] of Route.models()) {
        const ctor = model as unknown as Function;
        const found = models.get(ctor);
        if (!found) {
          ctx.diagnostics.push({
            code: "BUNYAD_ROUTE_014",
            message: `Route.model("${param}") class not found under app/Models.`,
            file: primaryEntry,
          });
          continue;
        }
        seenModelParams.add(param);
        modelIR.push({
          param,
          module: found.module,
          exportName: found.exportName,
          className: (ctor as { name: string }).name,
        });
      }

      // Controller type-hints → ModelIR (compile-time; no runtime source scan).
      const modelsByName = new Map<
        string,
        { ctor: Function; module: string; exportName: string }
      >();
      for (const [ctor, info] of models) {
        modelsByName.set((ctor as { name: string }).name, {
          ctor,
          module: info.module,
          exportName: info.exportName,
        });
      }

      for (const route of Route.routes) {
        if (!Array.isArray(route.action)) continue;
        const [Controller, method] = route.action as [
          new () => object,
          string,
        ];
        const found = controllers.get(Controller);
        if (!found) continue;
        const source = await readModuleSource(found.module, ctx.root);
        if (!source) continue;
        const paramList = controllerMethodParams(source, method);
        for (const p of paramList) {
          if (!p.typeName || p.typeName === "Request") continue;
          if (p.typeName.endsWith("Request")) continue;
          const model = modelsByName.get(p.typeName);
          if (!model) continue;
          const routeParam = route.paramNames.includes(p.name)
            ? p.name
            : route.paramNames.find(
                (name) =>
                  name ===
                    p.typeName!.charAt(0).toLowerCase() +
                      p.typeName!.slice(1) ||
                  name === p.typeName!.toLowerCase(),
              ) ??
              (route.paramNames.length === 1 ? route.paramNames[0]! : null);
          if (!routeParam || seenModelParams.has(routeParam)) continue;
          seenModelParams.add(routeParam);
          modelIR.push({
            param: routeParam,
            module: model.module,
            exportName: model.exportName,
            className: p.typeName,
          });
        }
      }

      const seen = new Set<string>();
      for (const route of routes) {
        for (const method of route.methods) {
          const key = `${method} ${route.uri}`;
          if (seen.has(key)) {
            ctx.diagnostics.push({
              code: "BUNYAD_ROUTE_002",
              message: `Duplicate route [${key}].`,
              file: primaryEntry,
            });
          }
          seen.add(key);
        }
      }

      ctx.ir.set("router", {
        routes,
        models: modelIR,
        entries,
        constructorInject,
      } satisfies RouterIR);
    },

    generate(ctx: GenerateContext) {
      const ir = ctx.ir.get("router") as RouterIR;
      const routesFile = "routes.ts";
      const outFile = `${ctx.outDir}/${routesFile}`;

      const controllerImports = new Map<
        string,
        { specifier: string; exportName: string; className: string }
      >();
      for (const route of ir.routes) {
        if (!route.controller) continue;
        const specifier = toImportSpecifier(
          outFile,
          route.controller.module,
        );
        controllerImports.set(route.controller.className, {
          specifier,
          exportName: route.controller.exportName,
          className: route.controller.className,
        });
      }

      const modelImports = new Map<string, string>();
      for (const model of ir.models) {
        const rel = toImportSpecifier(outFile, model.module);
        modelImports.set(model.className, rel);
      }

      const serviceImports = new Map<
        string,
        { specifier: string; exportName: string; className: string }
      >();
      for (const deps of Object.values(ir.constructorInject ?? {})) {
        for (const dep of deps) {
          if (controllerImports.has(dep.className) || modelImports.has(dep.className)) {
            continue;
          }
          serviceImports.set(dep.className, {
            specifier: toImportSpecifier(outFile, dep.module),
            exportName: dep.exportName,
            className: dep.className,
          });
        }
      }

      const importLines = [
        ...[...controllerImports.values()].map((c) =>
          controllerImportLine(c.className, c.exportName, c.specifier),
        ),
        ...[...modelImports.entries()].map(
          ([name, path]) => `import ${name} from "${path}";`,
        ),
        ...[...serviceImports.values()].map((s) =>
          controllerImportLine(s.className, s.exportName, s.specifier),
        ),
      ].join("\n");

      const constructorStampLines = Object.entries(ir.constructorInject ?? {})
        .filter(([, deps]) => deps.length > 0)
        .map(
          ([className, deps]) =>
            `Object.defineProperty(${className}, "inject", { value: [${deps.map((d) => d.className).join(", ")}] });`,
        )
        .join("\n");

      const modelLines = ir.models
        .map(
          (m) =>
            `  router.model(${JSON.stringify(m.param)}, ${m.className});`,
        )
        .join("\n");

      const registerLines = ir.routes
        .map((route) => {
          const primary = route.methods[0]!;
          const fn = verbFn(primary);
          const mw =
            route.middleware.length > 0
              ? `.middleware(${route.middleware.map((a) => JSON.stringify(a)).join(", ")})`
              : "";
          const where =
            Object.keys(route.wheres).length > 0
              ? `.where(${JSON.stringify(route.wheres)})`
              : "";
          const nameCall = route.name
            ? `.name(${JSON.stringify(route.name)})`
            : "";
          // Always stamped, even when empty: production refuses to look plans up on disk,
          // so "takes no arguments" has to be written down too.
          const injectCall = route.controller
            ? `.inject(${serializeInjectSlots(route.inject)})`
            : "";
          const chain = `${mw}${where}${nameCall}${injectCall}`;
          const uri = JSON.stringify(route.uri);
          const d = route.declaration;
          if (d?.kind === "view") {
            return `  router.view(${uri}, ${JSON.stringify(d.view)}, ${JSON.stringify(d.data)}, ${d.status})${chain};`;
          }
          if (d?.kind === "redirect") {
            return `  router.redirect(${uri}, ${JSON.stringify(d.to)}, ${d.status})${chain};`;
          }
          if (d?.kind === "handler") {
            const args = d.args.map((arg) => JSON.stringify(arg)).join(", ");
            return `  router.${fn}(${uri}, ${d.export}(${args}))${chain};`;
          }
          return `  router.${fn}(${uri}, [${route.controller!.className}, ${JSON.stringify(route.controller!.method)}])${chain};`;
        })
        .join("\n");

      // Handlers of helper routes (`inertiaPage`, `livePage`), by module.
      const handlerImports = new Map<string, Set<string>>();
      for (const route of ir.routes) {
        const d = route.declaration;
        if (d?.kind !== "handler") continue;
        if (!handlerImports.has(d.module)) handlerImports.set(d.module, new Set());
        handlerImports.get(d.module)!.add(d.export);
      }
      const handlerImportLines = [...handlerImports]
        .map(([module, names]) => `\nimport { ${[...names].join(", ")} } from ${JSON.stringify(module)};`)
        .join("");
      const routesSource = `import { Router, signed } from "@bunyad/router";${handlerImportLines}
import { auth, guest, can } from "@bunyad/auth";
import { throttle } from "@bunyad/http";
${importLines}
${constructorStampLines ? `\n${constructorStampLines}\n` : ""}
// Register middleware aliases used by string middleware in compiled routes.
void [auth, guest, can, throttle, signed];

export function createCompiledRouter(): Router {
  const router = new Router();
${modelLines}
${registerLines}
${optimize ? "  router.optimize();\n" : ""}  return router;
}
`;

      ctx.writeModule("routes", routesFile, routesSource);
      ctx.setManifestModule("routes", `./${routesFile}`);
      ctx.setManifestMeta("router", {
        count: ir.routes.length,
        models: ir.models.length,
        inject: ir.routes.filter((r) => r.inject.length > 0).length,
        optimize,
        entries: ir.entries.map((e) => e.replace(/\\/g, "/").split("/").pop()),
        warnings: ctx.diagnostics.filter((d) => d.severity === "warning").length,
      });
    },
  };
}

export function assertNoErrors(
  diagnostics: {
    code: string;
    message: string;
    file?: string;
    line?: number;
    severity?: "error" | "warning";
  }[],
): void {
  const errors = diagnostics.filter((d) => (d.severity ?? "error") === "error");
  if (errors.length === 0) return;
  const body = errors
    .map((d) => {
      const loc = d.file
        ? d.line
          ? `${d.file}:${d.line}`
          : d.file
        : undefined;
      return loc
        ? `${d.code}: ${d.message}\n  --> ${loc}`
        : `${d.code}: ${d.message}`;
    })
    .join("\n");
  throw new BunyadError(body, "BUNYAD_COMPILE_FAILED");
}
