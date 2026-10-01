import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BunyadError } from "@bunyad/common";
import {
  constructorParamsFromSource,
  importInfoForType,
} from "@bunyad/router";
import type { Application } from "./application.ts";
import { shouldFailClosedOnMissingInjectPlan } from "./route-model-action.ts";

const SKIP_TYPES = new Set([
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

const stamped = new WeakSet<Function>();

type InjectTarget = Function & { inject?: Function[] };

function hasConstructorMetadata(Class: Function): boolean {
  if (Array.isArray((Class as InjectTarget).inject)) return true;
  const meta = (
    Reflect as { getMetadata?(key: string, target: object): unknown }
  ).getMetadata?.("design:paramtypes", Class);
  return (
    Array.isArray(meta) &&
    meta.some((t) => typeof t === "function" && t !== Object)
  );
}

function isInjectableType(typeName: string | undefined): typeName is string {
  if (!typeName) return false;
  if (!/^[A-Z]/.test(typeName)) return false;
  return !SKIP_TYPES.has(typeName);
}

function controllerSourceFile(Controller: Function, app: Application): string | null {
  const name = Controller.name;
  if (!name) return null;
  const roots = [app.path("Http/Controllers"), app.basePath()];
  for (const root of roots) {
    for (const ext of [".ts", ".js"]) {
      const file = join(root, `${name}${ext}`);
      if (existsSync(file)) return file;
    }
  }
  if (shouldFailClosedOnMissingInjectPlan(app.basePath())) {
    return null;
  }
  const controllersRoot = app.path("Http/Controllers");
  if (!existsSync(controllersRoot)) return null;
  for (const entry of readdirSync(controllersRoot, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!entry.isFile()) continue;
    if (entry.name !== `${name}.ts` && entry.name !== `${name}.js`) continue;
    const parent =
      "parentPath" in entry && typeof entry.parentPath === "string"
        ? entry.parentPath
        : controllersRoot;
    return join(parent, entry.name);
  }
  return null;
}

function resolveSpecifier(spec: string, fromFile: string): string {
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const absolute = join(dirname(fromFile), spec);
    if (existsSync(absolute)) return absolute;
    if (existsSync(`${absolute}.ts`)) return `${absolute}.ts`;
    if (existsSync(`${absolute}.js`)) return `${absolute}.js`;
    return absolute;
  }
  return Bun.resolveSync(spec, fromFile);
}

function loadExport(file: string, exportName: string, typeName: string): Function | null {
  try {
    const mod = require(file) as Record<string, unknown>;
    const value =
      exportName === "default"
        ? (mod.default ?? mod[typeName])
        : (mod[exportName] ?? mod[typeName] ?? mod.default);
    return typeof value === "function" ? value : null;
  } catch {
    return null;
  }
}

function resolveTypeCtor(
  source: string,
  file: string,
  typeName: string,
): Function | null {
  const info = importInfoForType(source, typeName);
  if (!info || info.typeOnly) {
    return loadExport(file, typeName, typeName);
  }
  let resolved: string;
  try {
    resolved = resolveSpecifier(info.spec, file);
  } catch {
    return null;
  }
  return loadExport(resolved, info.exportName, typeName);
}

/**
 * Stamp `Controller.inject` from constructor type-hints so `app.make()`
 * can resolve them. No-op when Reflect metadata or `static inject` is set.
 */
export function stampControllerConstructorInject(
  Controller: Function,
  app: Application,
): void {
  if (stamped.has(Controller)) return;
  stamped.add(Controller);
  if (hasConstructorMetadata(Controller)) return;

  const file = controllerSourceFile(Controller, app);
  if (!file) return;

  const source = readFileSync(file, "utf8");
  if (/\bstatic\s+inject\s*=/.test(source)) return;

  const params = constructorParamsFromSource(source, Controller.name);
  const types: Function[] = [];
  for (const param of params) {
    if (!isInjectableType(param.typeName)) continue;
    const ctor = resolveTypeCtor(source, file, param.typeName);
    if (!ctor) {
      throw new BunyadError(
        `Cannot resolve constructor type [${param.typeName}] for ${Controller.name}. Import the class as a value (not \`import type\`).`,
        "BUNYAD_INJECT_002",
      );
    }
    types.push(ctor);
  }
  if (types.length > 0) {
    (Controller as InjectTarget).inject = types;
  }
}

/** Test helper: allow a class to be stamped again after file changes. */
export function resetControllerConstructorInjectCache(Controller: Function): void {
  stamped.delete(Controller);
  delete (Controller as InjectTarget).inject;
}
