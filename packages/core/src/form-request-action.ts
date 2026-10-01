import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  isFormRequestCtor,
  type FormRequestCtor,
} from "@bunyad/http";
import type { Application } from "./application.ts";

const FORM = Symbol.for("bunyad.formRequest");
const resolved = new WeakMap<Function, Map<string, FormRequestCtor | null>>();
const controllerFiles = new Map<string, string>();

type ActionFn = ((request: unknown) => unknown) & {
  [FORM]?: FormRequestCtor;
};

/** Bind a FormRequest class to a controller action (tests / explicit wiring). */
export function setFormRequestAction(
  Controller: Function,
  method: string,
  request: FormRequestCtor,
): void {
  const fn = (Controller as { prototype: Record<string, ActionFn> }).prototype[
    method
  ];
  if (typeof fn === "function") {
    fn[FORM] = request;
  }
  remember(Controller, method, request);
}

export function resolveFormRequest(
  Controller: Function,
  method: string,
  app: Application,
): FormRequestCtor | null | Promise<FormRequestCtor | null> {
  const cached = resolved.get(Controller)?.get(method);
  if (cached !== undefined) return cached;

  const fn = (Controller as { prototype: Record<string, ActionFn> }).prototype[
    method
  ];
  if (typeof fn !== "function" || fn.length === 0) {
    return remember(Controller, method, null);
  }
  if (isFormRequestCtor(fn[FORM])) {
    return remember(Controller, method, fn[FORM]);
  }

  const fromMeta = metadataParamType(Controller, method);
  if (isFormRequestCtor(fromMeta)) {
    return remember(Controller, method, fromMeta);
  }

  return fromControllerSource(Controller, method, app).then((Form) =>
    remember(Controller, method, Form),
  );
}

function remember(
  Controller: Function,
  method: string,
  Form: FormRequestCtor | null,
): FormRequestCtor | null {
  let methods = resolved.get(Controller);
  if (!methods) {
    methods = new Map();
    resolved.set(Controller, methods);
  }
  methods.set(method, Form);
  return Form;
}

function metadataParamType(Controller: Function, method: string): unknown {
  const proto = Controller.prototype as object;
  const R = Reflect as {
    getMetadata?(
      key: string,
      target: object,
      propertyKey?: string | symbol,
    ): unknown;
  };
  const meta = R.getMetadata?.("design:paramtypes", proto, method);
  if (Array.isArray(meta)) return meta[0];
  return R.getMetadata?.(`design:paramtypes:${method}`, proto);
}

async function fromControllerSource(
  Controller: Function,
  method: string,
  app: Application,
): Promise<FormRequestCtor | null> {
  const file = await controllerSourceFile(Controller, app);
  if (!file) return null;
  const source = await Bun.file(file).text();
  const typeName = actionParamType(source, method);
  if (!typeName || typeName === "Request") return null;
  const spec = importSpecifier(source, typeName);
  // Same-file FormRequest (exported from the controller module) has no import.
  const resolvedPath = spec
    ? (() => {
        try {
          return Bun.resolveSync(spec, dirname(file));
        } catch {
          return null;
        }
      })()
    : file;
  if (!resolvedPath) return null;
  const mod = (await import(resolvedPath)) as Record<string, unknown>;
  const Ctor = mod[typeName] ?? mod.default;
  return isFormRequestCtor(Ctor) ? Ctor : null;
}

async function controllerSourceFile(
  Controller: Function,
  app: Application,
): Promise<string | null> {
  const name = Controller.name;
  if (!name) return null;
  const cached = controllerFiles.get(name);
  if (cached) return cached;

  const roots = [app.path("Http/Controllers"), app.basePath()];
  for (const root of roots) {
    for (const ext of [".ts", ".js"]) {
      const file = join(root, `${name}${ext}`);
      if (existsSync(file)) {
        controllerFiles.set(name, file);
        return file;
      }
    }
  }
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const glob = new Bun.Glob(`**/${name}.{ts,js}`);
    for await (const file of glob.scan({ cwd: root, absolute: true })) {
      controllerFiles.set(name, file);
      return file;
    }
  }
  return null;
}

function actionParamType(source: string, method: string): string | null {
  const re = new RegExp(
    String.raw`(?:public|protected|private|async|static|\s)+${method}\s*\(\s*[A-Za-z_][\w]*\s*:\s*([A-Za-z_][\w]*)`,
  );
  return re.exec(source)?.[1] ?? null;
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
