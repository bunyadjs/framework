import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { controllerMiddlewareOf, declaredRoutesOf, middlewareAliasOf, routeMethodOf, routeNameOf, routeViewOf } from "@bunyad/http";
import { applyRouteFileBindings } from "./route-bindings.ts";
import { getActiveRouter, setActiveRouter, type RouteDefinition, type ControllerClass, type ResourceAction, type Router, type RouteMiddleware } from "./router.ts";

/** A view file as a responder sees it: the file (relative to the app) and its page name. */
export type PageRef = { file: string; name: string };

export type PageResponder = (page: PageRef, props: Record<string, unknown>, request: unknown) => unknown;

const pageResponders = new Map<string, PageResponder>();

/** Register how view files with these extensions (`.tsx`, `.vue`, …) are rendered from action data. */
export function setPageResponder(extensions: readonly string[], responder: PageResponder): void {
  for (const ext of extensions) pageResponders.set(ext, responder);
}

/** The responder for a view file, if one is registered for its extension. */
export function pageResponderFor(file: string): PageResponder | undefined {
  return pageResponders.get(extname(file));
}

/** Page name: the view path under `src/`, without the extension (`web/login/LoginPage`). */
export function pageName(file: string): string {
  const withoutExtension = file.slice(0, file.length - extname(file).length);
  if (withoutExtension.startsWith("src/")) return withoutExtension.slice(4);
  return withoutExtension.startsWith("routes/") ? withoutExtension.slice(7) : withoutExtension;
}

const livePages: { handler?: (component: string) => unknown; mount?: (router: Router) => void } = {};

/** Register how a Live component in a route folder answers its URL (`@bunyad/live-components` does this on import). */
export function setLivePageHandler(handler: (component: string) => unknown, mount?: (router: Router) => void): void {
  livePages.handler = handler;
  livePages.mount = mount;
}

/** Name a Live component in a route folder is registered under: its path in the tree, dotted (`(auth).login.LoginLive`). */
export function liveComponentName(root: string, file: string): string {
  const path = relative(root, file);
  return path.slice(0, path.length - extname(path).length).split(sep).join(".");
}

const controllerSources = new WeakMap<Function, string>();

/**
 * Source file of a controller that came from a route folder. Lookups that need the file (typed
 * parameters, constructor injection) ask here first, so they never search the disk by class name.
 */
export function controllerSourceFile(controller: Function): string | undefined {
  return controllerSources.get(controller);
}

const VIEW_EXTENSIONS = new Set([".tsx", ".jsx", ".vue", ".svelte", ".html", ".view"]);
/** Pages at the root of the route tree that render errors (see `registerErrorPages`). */
export const ERROR_PAGES = new Set(["NotFoundPage", "ForbiddenPage", "ExpiredPage", "ErrorPage"]);
const CODE_EXTENSIONS = new Set([".ts", ".js", ".mts", ".mjs"]);
const ACTION_VIEWS = ["index", "create", "show", "edit"] as const;

/** HTTP verb and URI suffix for each resource action. `{param}` is the folder's own parameter. */
const ACTIONS: Record<ResourceAction, { methods: string[]; suffix: string; member: boolean }> = {
  index: { methods: ["GET"], suffix: "", member: false },
  create: { methods: ["GET"], suffix: "/create", member: false },
  store: { methods: ["POST"], suffix: "", member: false },
  show: { methods: ["GET"], suffix: "", member: true },
  edit: { methods: ["GET"], suffix: "/edit", member: true },
  update: { methods: ["PUT", "PATCH"], suffix: "", member: true },
  destroy: { methods: ["DELETE"], suffix: "", member: true },
};

/** Verbs of each action in a folder that is one page (no `index`, no `[param]` child). */
const SINGLE_ACTIONS: Partial<Record<ResourceAction, string[]>> = {
  create: ["GET"],
  show: ["GET"],
  edit: ["GET"],
  store: ["POST"],
  update: ["PUT", "PATCH"],
  destroy: ["DELETE"],
};

/** One folder of the route tree. */
export type RouteFolder = {
  /** Absolute path of the folder. */
  dir: string;
  /** Folder path relative to the route root (`products/[product]/reviews`). */
  path: string;
  /** URI of the folder, without the member parameter (`/products/{product}/reviews`). */
  uri: string;
  /** Route-name prefix (`products.reviews`); parameter and group segments are left out. */
  name: string;
  /** Own dynamic segment when this folder is `[param]`. */
  param?: string;
  /** Name of a child `[param]` folder, used for the member URL of this folder's controller. */
  memberParam?: string;
  controller?: string;
  /** A Live component (`LoginLive.ts`): the folder's page, rendered by the component. */
  live?: string;
  /** Every controller in the folder. More than one is allowed only in a `(group)` folder. */
  controllers: string[];
  /** `*Page` view files by name without the suffix (`LoginPage.tsx` -> `Login`). */
  pages: Record<string, string>;
  requests?: string;
  policy?: string;
  layout?: string;
  middleware?: string;
  /** `<area>.routes.ts`: middleware, a prefix and access rules for this folder and everything below. */
  routesConfig?: string;
  routeFile?: string;
  /** View file by action name (`index`, `create`, `show`, `edit`, `page`). */
  views: Record<string, string>;
};

export type RouteScan = {
  root: string;
  folders: RouteFolder[];
  /** Files in a route folder that are neither reserved nor private. */
  stray: string[];
};

/** A `(group)` folder adds no URL segment, so the routes of its controllers are all declared. */
function isGroupDir(dir: string): boolean {
  return /^\(.+\)$/.test(basename(dir));
}

function pascal(method: string): string {
  return method.charAt(0).toUpperCase() + method.slice(1);
}

function stem(file: string): string {
  return basename(file, extname(file));
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[a-z]+$/.test(file);
}

type Segment = { uri: string; name: string; param?: string };

function parseSegment(segment: string, browserRouted = false): Segment | null {
  if (segment.startsWith("(") && segment.endsWith(")")) return null;
  const rest = /^\[\.\.\.(.+)\]$/.exec(segment);
  // Below a spa.routes.ts a catch-all folder is the browser's concern, not a server route.
  if (rest && browserRouted) return { uri: `{${rest[1]}}`, name: "", param: rest[1] };
  if (rest) {
    throw new Error(`Catch-all route folders ([...${rest[1]}]) are not supported yet.`);
  }
  const dynamic = /^\[(.+)\]$/.exec(segment);
  if (dynamic) return { uri: `{${dynamic[1]}}`, name: "", param: dynamic[1] };
  return { uri: segment, name: segment };
}

/**
 * Walk the route tree once. Pure file-system work: nothing is imported or executed, so it is safe
 * at build time and in `route:list`. Folders and files starting with `_` and test files are skipped.
 */
export function scanRoutes(root: string): RouteScan {
  if (!existsSync(root)) throw new Error(`Route folder not found: ${root}`);
  const folders: RouteFolder[] = [];
  const stray: string[] = [];

  const walk = (dir: string, uriParts: string[], nameParts: string[], clientOnly = false) => {
    const entries = readdirSync(dir).sort();
    // A `spa.routes.ts` marks a folder whose pages are routed in the browser (a React Router table, say): the
    // server does not make routes of the views below it.
    const spa = clientOnly || entries.includes("spa.routes.ts") || entries.includes("spa.routes.js");
    const rel = relative(root, dir);
    const own = rel === "" ? undefined : parseSegment(basename(dir), spa);
    const folder: RouteFolder = {
      dir,
      path: rel,
      uri: "/" + uriParts.join("/"),
      name: nameParts.join("."),
      param: own?.param,
      views: {},
      controllers: [],
      pages: {},
    };

    // Classify one file of the folder; files in a `pages/` subfolder count as the folder's own.
    const classify = (entry: string, full: string): void => {
      if (isTestFile(entry)) return;
      if (spa && VIEW_EXTENSIONS.has(extname(entry))) return;
      // `NotFoundPage`, `ErrorPage`, … at the root answer errors; they are not routes.
      if (rel === "" && ERROR_PAGES.has(stem(entry))) return;
        const ext = extname(entry);
        const base = stem(entry);
        if (CODE_EXTENSIONS.has(ext) && (base === "controller" || /^[A-Z]\w*Controller$/.test(base))) {
          if (folder.controller && !isGroupDir(dir)) throw new Error(`${dir}: one controller per folder (found ${basename(folder.controller)} and ${entry}). Only a (group) folder may hold several.`);
          folder.controller ??= full;
          folder.controllers.push(full);
        } else if (CODE_EXTENSIONS.has(ext) && /^[A-Z]\w*Live$/.test(base)) {
          if (folder.live) throw new Error(`${dir}: one Live component per folder (found ${basename(folder.live)} and ${entry}).`);
          folder.live = full;
        } else if (CODE_EXTENSIONS.has(ext) && (base === "requests" || /^[A-Z]\w*Requests?$/.test(base))) folder.requests ??= full;
        else if (CODE_EXTENSIONS.has(ext) && (base === "policy" || /^[A-Z]\w*Policy$/.test(base))) folder.policy = full;
        else if (CODE_EXTENSIONS.has(ext) && base === "middleware") folder.middleware = full;
      else if (CODE_EXTENSIONS.has(ext) && /^[\w-]+\.routes$/.test(base)) {
        if (folder.routesConfig) throw new Error(`${dir}: one *.routes.ts per folder (found ${basename(folder.routesConfig)} and ${entry}).`);
        folder.routesConfig = full;
      }
        else if (CODE_EXTENSIONS.has(ext) && base === "route") folder.routeFile = full;
        else if (VIEW_EXTENSIONS.has(ext) && base === "layout") folder.layout = full;
        else if (VIEW_EXTENSIONS.has(ext) && (base === "page" || (ACTION_VIEWS as readonly string[]).includes(base))) {
          folder.views[base] = full;
        } else if (VIEW_EXTENSIONS.has(ext) && /Page$/.test(base)) {
          // `LoginPage.tsx` is the folder's page; `ProductEditPage.tsx` is the page of `edit`.
          folder.pages[base.slice(0, -4)] = full;
          if (!isGroupDir(dir)) {
            const action = /(Index|Create|Show|Edit)Page$/.exec(base)?.[1]?.toLowerCase() ?? "page";
            if (folder.views[action]) throw new Error(`${dir}: two views for "${action}" (${basename(folder.views[action]!)} and ${entry}).`);
            folder.views[action] = full;
          }
        } else stray.push(full);
    };

    for (const entry of entries) {
      const full = join(dir, entry);
      if (entry.startsWith("_") || entry.startsWith(".")) continue;
      if (statSync(full).isDirectory()) {
        // `Models`, `Providers`, `Http`: code folders start with a capital letter and are never URLs.
        if (/^[A-Z]/.test(entry)) continue;
        if (entry === "requests") {
          folder.requests = full;
          continue;
        }
        // The folder's views can live in `pages/`, apart from its controllers and requests.
        if (entry === "pages") {
          for (const file of readdirSync(full).sort()) {
            if (!file.startsWith("_") && !file.startsWith(".") && !statSync(join(full, file)).isDirectory()) classify(file, join(full, file));
          }
          continue;
        }
        // Below a spa.routes.ts the folders are the browser's routes, so `[...rest]` and the like are fine.
        const seg = parseSegment(entry, spa);
        walk(
          full,
          seg ? [...uriParts, seg.uri] : uriParts,
          seg?.name ? [...nameParts, seg.name] : nameParts,
          spa,
        );
        continue;
      }
      classify(entry, full);
    }
    folder.memberParam = entries
      .map((e) => /^\[([^.\]]+)\]$/.exec(e)?.[1])
      .find((p) => p !== undefined && statSync(join(dir, `[${p}]`)).isDirectory());
    folders.push(folder);
  };

  walk(root, [], []);
  return { root, folders, stray };
}

export type FileRoute = {
  methods: string[];
  uri: string;
  name: string;
  folder: RouteFolder;
  /** Absent for a page with no controller. */
  controller?: ControllerClass;
  /** Patterns for its parameters (`where` on a route decorator). */
  where?: Record<string, string>;
  /** Hosts this route answers on (`admin.example.com`, `{tenant}.example.com`); one route is added per host. */
  domains?: string[];
  /** A Live component answers this route: its file and registered name. */
  live?: { file: string; name: string };
  action: string;
  view?: string;
  middleware: RouteMiddleware[];
  /** Set on a decorated route (`{ access: "auth" }`); replaces the access its area gives it. */
  access?: string;
};

export type RegisterFileRoutesOptions = {
  /** Import a module; defaults to a cache-busting dynamic import. */
  load?: (file: string) => Promise<Record<string, unknown>>;
  /** Middleware for the whole tree when its root has no `middleware.ts`. */
  defaultMiddleware?: RouteMiddleware[];
  /** Values for `{root}` in a `domain` (default `APP_DOMAIN`). */
  vars?: { root?: string };
  /** Folders (paths relative to the tree, such as `(web)/(central)`) whose routes are not registered, with everything below them. */
  exclude?: string[];
};

async function defaultLoad(file: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}

/** URL prefixes from `middleware.ts` files (`export const prefix = "api"`), outermost first. */
function prefixFor(folder: RouteFolder, prefixes: Map<string, string>, root: string): string {
  if (prefixes.size === 0) return "";
  const parts = folder.path === "" ? [] : folder.path.split("/");
  const dirs = [root, ...parts.map((_, i) => join(root, ...parts.slice(0, i + 1)))];
  return dirs.map((d) => prefixes.get(d)).filter(Boolean).join("/");
}

function withPrefix(prefix: string, uri: string): string {
  if (!prefix) return uri;
  return uri === "/" || uri === "" ? `/${prefix}` : `/${prefix}${uri}`;
}

/** Middleware that say who may open a page: a route has at most one of them. */
/** Who may open a route: guests only, signed-in users, or anyone (`public`, which adds no middleware). */
const ACCESS = new Set<unknown>(["guest", "auth", "public"]);

function withAccess(chain: RouteMiddleware[], name: RouteMiddleware): RouteMiddleware[] {
  if (name === "public") return chain.filter((m) => m !== "guest" && m !== "auth");
  return [...chain.filter((m) => !ACCESS.has(m) || m === name), ...(chain.includes(name) ? [] : [name])];
}

/** `login`, `reset-password/*`, `settings/**`: `*` is one URL segment, `**` is the rest. */
function matchesPattern(pattern: string, path: string): boolean {
  const want = pattern.split("/").filter(Boolean);
  const have = path.split("/").filter(Boolean);
  for (let i = 0; i < want.length; i++) {
    if (want[i] === "**") return true;
    if (i >= have.length) return false;
    if (want[i] !== "*" && want[i] !== have[i]) return false;
  }
  return want.length === have.length;
}

function middlewareChain(folder: RouteFolder, byDir: Map<string, RouteMiddleware[]>, selfOnly: Set<string>, root: string): RouteMiddleware[] {
  const chain: RouteMiddleware[] = [];
  const seen = new Set<unknown>();
  const parts = folder.path === "" ? [] : folder.path.split("/");
  const dirs = [root, ...parts.map((_, i) => join(root, ...parts.slice(0, i + 1)))];
  for (const dir of dirs) {
    const own = byDir.get(dir);
    if (!own) continue;
    if (selfOnly.has(dir) && dir !== folder.dir) continue;
    for (const m of own) {
      if (seen.has(m)) continue;
      seen.add(m);
      chain.push(m);
    }
  }
  return chain;
}

function singularOf(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ses") || word.endsWith("xes")) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

/** Whether a route already carries access middleware, from its chain or its controller's decorators. */
function isGuarded(r: FileRoute): boolean {
  const names = (list: readonly unknown[]) => list.some((m) => m === "guest" || m === "auth" || (typeof m === "string" && (m.startsWith("can:") || m.startsWith("auth:"))));
  if (names(r.middleware)) return true;
  if (!r.controller) return false;
  return names(controllerMiddlewareOf(r.controller, r.action).map((m) => middlewareAliasOf(m)));
}

/** The view of an action: its own file, or the folder's single `*Page` for the GET action. */
function viewOf(folder: RouteFolder, member: RouteFolder | undefined, action: string, single: boolean, get: boolean, controller?: ControllerClass): string | undefined {
  const override = controller ? routeViewOf(controller, action) : undefined;
  if (override) return resolve(folder.dir, override);
  const own = folder.views[action] ?? member?.views[action];
  if (own) return own;
  if (!get) return undefined;
  // The page of a `[param]` folder is the view of `show`.
  if (!single && action === "show" && member?.views.page) return member.views.page;
  const primary = single ? ["create", "show", "edit", "handle"].includes(action) : action === "index";
  return primary ? folder.views.page : undefined;
}

function resourceActionsOf(controller: ControllerClass): ResourceAction[] {
  const proto = controller.prototype as Record<string, unknown>;
  return (Object.keys(ACTIONS) as ResourceAction[]).filter((a) => typeof proto[a] === "function");
}

/** Static first, then dynamic, so `/products/create` always wins over `/products/{product}`. */
function routeOrder(a: FileRoute, b: FileRoute): number {
  const dyn = (u: string) => (u.match(/\{/g) ?? []).length;
  return dyn(a.uri) - dyn(b.uri) || a.uri.localeCompare(b.uri);
}

/**
 * Import the controllers found by `scanRoutes` and list the routes they define. Resource actions map
 * to routes by method name; a controller defines only the routes it has methods for. A controller
 * with only `handle()` becomes one GET route at the folder URL (`@Method("POST")` changes the verb).
 */
export async function collectFileRoutes(scan: RouteScan, options: RegisterFileRoutesOptions = {}): Promise<FileRoute[]> {
  const load = options.load ?? defaultLoad;
  const byDir = new Map<string, RouteMiddleware[]>();
  const selfOnly = new Set<string>();
  const prefixes = new Map<string, string>();

  for (const folder of scan.folders) {
    if (!folder.middleware) continue;
    const mod = await load(folder.middleware);
    const list = mod.default;
    if (!Array.isArray(list)) throw new Error(`${folder.middleware}: default export must be an array of middleware.`);
    byDir.set(folder.dir, list as RouteMiddleware[]);
    if (mod.scope === "self") selfOnly.add(folder.dir);
    if (typeof mod.prefix === "string" && mod.prefix.replace(/^\/+|\/+$/g, "")) prefixes.set(folder.dir, mod.prefix.replace(/^\/+|\/+$/g, ""));
  }
  /** Access rules from `*.routes.ts`: middleware name -> URL patterns relative to the file's folder. */
  const rules: { folder: RouteFolder; file: string; middleware: string; patterns: string[]; used: boolean[]; area?: boolean }[] = [];
  /** Areas whose every route must say who may open it (`strict: true` in `*.routes.ts`). */
  const strictAreas: RouteFolder[] = [];
  /** Hosts an area answers on (`domain` in `*.routes.ts`). */
  const areaDomains: { folder: RouteFolder; domains: string[] }[] = [];
  for (const folder of scan.folders) {
    if (!folder.routesConfig) continue;
    const mod = (await load(folder.routesConfig)).default as { use?: RouteMiddleware[]; access?: string; prefix?: string; strict?: boolean; domain?: string | string[]; rules?: Record<string, string | string[]> } | undefined;
    if (!mod || typeof mod !== "object") throw new Error(`${folder.routesConfig}: default export must be an object ({ use, prefix, rules }).`);
    if (mod.use) byDir.set(folder.dir, [...(byDir.get(folder.dir) ?? []), ...mod.use]);
    if (mod.strict) strictAreas.push(folder);
    if (mod.domain) areaDomains.push({ folder, domains: (Array.isArray(mod.domain) ? mod.domain : [mod.domain]).map((d) => d.replaceAll("{root}", options.vars?.root ?? process.env.APP_DOMAIN ?? "localhost")) });
    if (mod.access) rules.push({ folder, file: folder.routesConfig, middleware: mod.access, patterns: ["**"], used: [false], area: true });
    const prefix = typeof mod.prefix === "string" ? mod.prefix.replace(/^\/+|\/+$/g, "") : "";
    if (prefix) prefixes.set(folder.dir, prefix);
    for (const [middleware, patterns] of Object.entries(mod.rules ?? {})) {
      const list = Array.isArray(patterns) ? patterns : [patterns];
      rules.push({ folder, file: folder.routesConfig, middleware, patterns: list, used: list.map(() => false) });
    }
  }
  if (!byDir.has(scan.root) && options.defaultMiddleware) byDir.set(scan.root, options.defaultMiddleware);

  const routes: FileRoute[] = [];
  const declared = new Set<FileRoute>();
  const controllerOf = new Map<RouteFolder, ControllerClass>();
  /** Folders whose single controller serves the folders below that have none of their own. */
  const inheritable = new Map<RouteFolder, ControllerClass>();
  for (const folder of scan.folders) {
    if (folder.controllers.length > 0 && isGroupDir(folder.dir)) {
      // Controllers in a group folder declare every route: `@Get("/login")`, `@Post("/login", { name: … })`.
      const middleware = middlewareChain(folder, byDir, selfOnly, scan.root);
      if (folder.controllers.length === 1) {
        const lone = (await load(folder.controllers[0]!)).default;
        if (typeof lone === "function") inheritable.set(folder, lone as ControllerClass);
      }
      for (const file of folder.controllers) {
        const controller = (await load(file)).default as ControllerClass | undefined;
        if (typeof controller !== "function") throw new Error(`${file}: default export must be a controller class.`);
        controllerSources.set(controller, file);
        for (const [method, specs] of declaredRoutesOf(controller)) {
          specs.forEach((spec, i) => {
            const override = routeViewOf(controller, method);
            routes.push({
              methods: [spec.method],
              uri: ((folder.uri === "/" ? "" : folder.uri) + (spec.path === "/" ? "" : spec.path.startsWith("/") ? spec.path : `/${spec.path}`)) || "/",
              name: spec.name ?? (i === 0 ? routeNameOf(controller, method) ?? method : `${method}.${i + 1}`),
              folder,
              controller,
              action: method,
              view: spec.method === "GET" ? (override ? resolve(folder.dir, override) : folder.pages[pascal(method)]) : undefined,
              middleware,
              access: spec.access,
              where: spec.where,
            });
          });
        }
      }
      continue;
    }
    if (!folder.controller || folder.routeFile) continue;
    const mod = await load(folder.controller);
    const controller = mod.default as ControllerClass | undefined;
    if (typeof controller !== "function") throw new Error(`${folder.controller}: default export must be a controller class.`);
    controllerSources.set(controller, folder.controller);
    controllerOf.set(folder, controller);
    if (folder.controllers.length === 1) inheritable.set(folder, controller);
    const middleware = middlewareChain(folder, byDir, selfOnly, scan.root);
    const prefix = folder.name ? `${folder.name}.` : "";
    const base = folder.uri === "/" ? "" : folder.uri;
    const last = (folder.path.split("/").pop() ?? "").replace(/-/g, "_");
    const param = folder.memberParam ?? singularOf(last);
    const member = `${base}/{${param}}`;
    const memberFolder = folder.memberParam ? scan.folders.find((f) => f.path === join(folder.path, `[${folder.memberParam}]`)) : undefined;

    const declared = declaredRoutesOf(controller);
    const single = !folder.memberParam && !resourceActionsOf(controller).includes("index");
    for (const [method, specs] of declared) {
      specs.forEach((spec, i) => {
        const path = spec.path === "/" ? "" : spec.path.startsWith("/") ? spec.path : `/${spec.path}`;
        routes.push({
          methods: [spec.method],
          uri: (base + path) || "/",
          name: spec.name ?? (i === 0 ? (routeNameOf(controller, method) ?? `${prefix}${method}`) : `${prefix}${method}.${i + 1}`),
          folder,
          controller,
          action: method,
          view: viewOf(folder, memberFolder, method, single, spec.method === "GET", controller),
          middleware,
          access: spec.access,
          where: spec.where,
        });
      });
    }
    const actions = resourceActionsOf(controller).filter((a) => !declared.has(a));
    const hasHandle = typeof (controller.prototype as { handle?: unknown }).handle === "function" && !declared.has("handle");

    if (actions.length === 0 && hasHandle) {
      routes.push({
        methods: routeMethodOf(controller) ?? ["GET"],
        uri: base || "/",
        name: routeNameOf(controller, "handle") ?? (folder.name || "root"),
        folder,
        controller,
        action: "handle",
        view: viewOf(folder, memberFolder, "handle", true, (routeMethodOf(controller) ?? ["GET"])[0] === "GET", controller),
        middleware,
      });
      continue;
    }

    for (const action of actions) {
      if (single) {
        // One page at the folder URL: create, show and edit are its GET; the rest use the other verbs.
        const verbs = SINGLE_ACTIONS[action];
        if (!verbs) continue;
        routes.push({
          methods: verbs,
          uri: base || "/",
          name: routeNameOf(controller, action) ?? (verbs[0] === "GET" ? folder.name || "root" : `${prefix}${action}`),
          folder,
          controller,
          action,
          view: viewOf(folder, memberFolder, action, true, verbs[0] === "GET", controller),
          middleware,
        });
        continue;
      }
      const def = ACTIONS[action];
      const memberUri = def.member ? member : base;
      routes.push({
        methods: def.methods,
        uri: (memberUri + def.suffix) || "/",
        name: routeNameOf(controller, action) ?? `${prefix}${action}`,
        folder,
        controller,
        action,
        view: viewOf(folder, memberFolder, action, false, def.methods[0] === "GET", controller),
        middleware,
      });
    }
  }
  // Folders with no controller of their own: the nearest controller above serves them, by method name
  // (`login()` for GET /login, `postLogin()` for POST), and a folder with only a view is a page.
  const byPath = new Map(scan.folders.map((f) => [f.path, f]));
  const ancestorOf = (folder: RouteFolder): { folder: RouteFolder; controller: ControllerClass } | undefined => {
    const parts = folder.path === "" ? [] : folder.path.split("/");
    for (let n = parts.length - 1; n >= 0; n--) {
      const up = byPath.get(parts.slice(0, n).join("/"));
      const controller = up && inheritable.get(up);
      if (up && controller) return { folder: up, controller };
    }
    return undefined;
  };
  for (const folder of scan.folders) {
    if (folder.controllers.length > 0 || folder.routeFile || folder.live) continue;
    const chain = middlewareChain(folder, byDir, selfOnly, scan.root);
    const uri = folder.uri === "/" ? "/" : folder.uri;
    const inherited = ancestorOf(folder);
    const segment = [...(folder.path === "" ? [] : folder.path.split("/"))].reverse().find((seg) => !/^[(\[]/.test(seg));
    let hasGet = false;
    if (inherited && segment) {
      const proto = inherited.controller.prototype as Record<string, unknown>;
      const declared = declaredRoutesOf(inherited.controller);
      const base = segment.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
      const Base = base.charAt(0).toUpperCase() + base.slice(1);
      const has = (method: string) => typeof proto[method] === "function" && !declared.has(method);
      const verbs: [string, string[], string][] = [
        [base, ["GET"], folder.name],
        [`post${Base}`, ["POST"], "store"],
        [`put${Base}`, ["PUT", "PATCH"], "update"],
        [`patch${Base}`, ["PUT", "PATCH"], "update"],
        [`delete${Base}`, ["DELETE"], "destroy"],
      ];
      const seen = new Set<string>();
      const ownSegment = folder.path.split("/").pop() ?? "";
      for (const [method, methods, action] of verbs) {
        if (!has(method) || seen.has(methods.join())) continue;
        const isGet = methods[0] === "GET";
        // A GET needs a view (a page); a `[param]` folder is only the page for its value.
        if (isGet ? !folder.views.page : ownSegment.startsWith("[")) continue;
        seen.add(methods.join());
        hasGet ||= isGet;
        routes.push({
          methods,
          uri,
          name: routeNameOf(inherited.controller, method) ?? (isGet ? folder.name || "home" : `${folder.name ? `${folder.name}.` : ""}${action}`),
          folder,
          controller: inherited.controller,
          action: method,
          view: isGet ? folder.views.page : undefined,
          middleware: chain,
        });
      }
    }
    // A folder with a view and no method for it is a page: GET at the folder URL, named after the folder.
    // It has no method to carry the controller's class-level `@Middleware`, so the page takes it here.
    // (A parent controller's member route, such as `show` for `[token]`, may already serve this URL.)
    if (!hasGet && folder.views.page && !routes.some((r) => r.uri === uri && r.methods.includes("GET"))) {
      const fromClass = inherited ? controllerMiddlewareOf(inherited.controller, "").map((m) => middlewareAliasOf(m)).filter((m): m is string => typeof m === "string") : [];
      const pageChain = fromClass.reduce<RouteMiddleware[]>((acc, m) => (ACCESS.has(m) ? withAccess(acc, m) : acc.includes(m) ? acc : [...acc, m]), chain);
      routes.push({
        methods: ["GET"],
        uri,
        name: folder.name || "home",
        folder,
        controller: undefined,
        action: "",
        view: folder.views.page,
        middleware: pageChain,
      });
    }
  }
  // A folder's view is its GET page, so the controller needs no empty `create() {}` to say so.
  for (const [folder, controller] of controllerOf) {
    const page = folder.views.page;
    if (!page || folder.memberParam || resourceActionsOf(controller).includes("index")) continue;
    const uri = folder.uri === "/" ? "/" : folder.uri;
    const hasGet = routes.some((r) => r.folder === folder && r.methods.includes("GET") && r.uri === uri);
    if (hasGet) continue;
    routes.push({
      methods: ["GET"],
      uri,
      name: folder.name || "home",
      folder,
      controller: undefined,
      action: "",
      view: page,
      middleware: middlewareChain(folder, byDir, selfOnly, scan.root),
    });
  }
  // A Live component is its folder's page: GET at the folder URL, named after the folder.
  for (const folder of scan.folders) {
    if (!folder.live) continue;
    const Ctor = (await load(folder.live)).default as ({ routeName?: string } & Function) | undefined;
    if (typeof Ctor !== "function") throw new Error(`${folder.live}: default export must be a Live component class.`);
    routes.push({
      methods: ["GET"],
      uri: folder.uri === "/" ? "/" : folder.uri,
      name: Ctor.routeName ?? (folder.name || "home"),
      folder,
      live: { file: folder.live, name: liveComponentName(scan.root, folder.live) },
      action: "",
      middleware: middlewareChain(folder, byDir, selfOnly, scan.root),
    });
  }
  // Access rules from `*.routes.ts`: add the middleware to every route whose URL matches.
  // Outer areas first, so an inner rule is the more specific one.
  rules.sort((a, b) => a.folder.path.split("/").filter(Boolean).length - b.folder.path.split("/").filter(Boolean).length);
  for (const rule of rules) {
    const base = rule.folder.uri === "/" ? "" : rule.folder.uri;
    for (const r of routes) {
      const inside = rule.folder.path === "" || r.folder.path === rule.folder.path || r.folder.path.startsWith(`${rule.folder.path}/`);
      if (!inside || !(r.uri === base || r.uri.startsWith(`${base}/`) || base === "")) continue;
      const relative = r.uri.slice(base.length);
      rule.patterns.forEach((pattern, i) => {
        if (!matchesPattern(pattern, relative)) return;
        rule.used[i] = true;
        if (ACCESS.has(rule.middleware)) declared.add(r);
        r.middleware = ACCESS.has(rule.middleware) ? withAccess(r.middleware, rule.middleware) : r.middleware.includes(rule.middleware) ? r.middleware : [...r.middleware, rule.middleware];
      });
    }
    const missed = rule.area ? [] : rule.patterns.filter((_, i) => !rule.used[i]);
    if (missed.length > 0) throw new Error(`${rule.file}: "${rule.middleware}" matches no route for ${missed.map((p) => `"${p}"`).join(", ")}.`);
  }
  // `{ access }` on a route decorator is the most specific.
  for (const r of routes) {
    if (!r.access) continue;
    r.middleware = withAccess(r.middleware, r.access);
    declared.add(r);
  }
  // A strict area has no default: every route in it says who may open it, by a rule, a decorator
  // (`@Middleware("auth")`, `@Can("update", "post")`, `{ access }`) or `public`.
  for (const area of strictAreas) {
    const open = routes.filter((r) => (area.path === "" || r.folder.path === area.path || r.folder.path.startsWith(`${area.path}/`)) && !declared.has(r) && !isGuarded(r));
    if (open.length > 0) {
      throw new Error(`${area.routesConfig}: strict area, but no access is declared for ${open.map((r) => `${r.methods.join("|")} ${r.uri}`).join(", ")}. Add them to rules, or mark them public.`);
    }
  }
  for (const { folder: area, domains } of areaDomains) {
    for (const r of routes) {
      if (area.path === "" || r.folder.path === area.path || r.folder.path.startsWith(`${area.path}/`)) r.domains = domains;
    }
  }
  for (const r of routes) r.uri = withPrefix(prefixFor(r.folder, prefixes, scan.root), r.uri);
  return routes.sort(routeOrder);
}

/**
 * Folders with a `route.ts` declare their own routes (`export default function (router)`), with URIs
 * relative to the folder and the folder's `middleware.ts` chain applied. They replace the
 * convention routes of that folder.
 */
async function registerRouteFiles(scan: RouteScan, router: Router, options: RegisterFileRoutesOptions): Promise<void> {
  const load = options.load ?? defaultLoad;
  const previous = getActiveRouter();
  const byDir = new Map<string, RouteMiddleware[]>();
  const selfOnly = new Set<string>();
  const prefixes = new Map<string, string>();
  for (const folder of scan.folders) {
    if (!folder.middleware) continue;
    const mod = await load(folder.middleware);
    byDir.set(folder.dir, mod.default as RouteMiddleware[]);
    if (mod.scope === "self") selfOnly.add(folder.dir);
    if (typeof mod.prefix === "string" && mod.prefix.replace(/^\/+|\/+$/g, "")) prefixes.set(folder.dir, mod.prefix.replace(/^\/+|\/+$/g, ""));
  }
  if (!byDir.has(scan.root) && options.defaultMiddleware) byDir.set(scan.root, options.defaultMiddleware);
  setActiveRouter(router);
  try {
    for (const folder of scan.folders) {
      if (!folder.routeFile) continue;
      if (folder.controller) {
        const own = (await load(folder.controller)).default;
        if (typeof own === "function") controllerSources.set(own, folder.controller);
      }
      const mod = await load(folder.routeFile);
      if (typeof mod.default !== "function") throw new Error(`${folder.routeFile}: default export must be a function (router) => void.`);
      const chain = middlewareChain(folder, byDir, selfOnly, scan.root);
      const prefix = prefixFor(folder, prefixes, scan.root);
      let group = router.prefix(withPrefix(prefix, folder.uri === "/" ? "" : folder.uri));
      if (chain.length > 0) group = group.middleware(...chain);
      await group.group(async () => {
        await (mod.default as (router: Router) => void | Promise<void>)(router);
      });
      await applyRouteFileBindings(router, folder.routeFile);
    }
  } finally {
    setActiveRouter(previous);
  }
}

/** Register the routes of a route tree on a router. Returns what was registered. */
export async function registerFileRoutes(
  root: string | RouteScan,
  router: Router = getActiveRouter(),
  options: RegisterFileRoutesOptions = {},
): Promise<FileRoute[]> {
  const whole = typeof root === "string" ? scanRoutes(root) : root;
  const excluded = (path: string) => (options.exclude ?? []).some((skip) => path === skip || path.startsWith(`${skip}/`));
  const scan = options.exclude?.length ? { ...whole, folders: whole.folders.filter((folder) => !excluded(folder.path)) } : whole;
  const routes = await collectFileRoutes(scan, options);
  await registerRouteFiles(scan, router, options);
  // The update endpoint and client script the components talk to.
  if (routes.some((r) => r.live) && livePages.mount) {
    const mount = livePages.mount;
    const base = options.defaultMiddleware ?? [];
    if (base.length > 0) await router.middleware(...base).group(() => mount(router));
    else mount(router);
  }
  const seen = new Map<string, FileRoute>();
  for (const r of routes) {
    for (const method of r.methods) {
      const key = `${method} ${(r.domains ?? [""]).join("|")}${r.uri}`;
      const prior = seen.get(key);
      if (prior) {
        throw new Error(`Duplicate route ${key}: ${prior.folder.controller} and ${r.folder.controller}.`);
      }
      seen.set(key, r);
    }
    // A route on several hosts is registered once per host; the first keeps the name.
    for (const [index, domain] of (r.domains ?? [undefined]).entries()) {
      const name = index === 0 ? r.name : "";
      let registrar;
      if (r.live) {
        if (!livePages.handler) throw new Error(`${r.live.file}: Live components need @bunyad/live-components.`);
        registrar = router.add(r.methods, r.uri, livePages.handler(r.live.name) as never);
        registrar.declare({ kind: "handler", module: "@bunyad/live-components", export: "livePage", args: [r.live.name] });
      } else {
        registrar = r.controller ? router.add(r.methods, r.uri, [r.controller, r.action]) : router.add(r.methods, r.uri, () => null).declare({ kind: "page" });
        if (r.view) registrar.page(relative(join(scan.root, ".."), r.view).split(sep).join("/"));
      }
      if (name) registrar.name(name);
      if (domain) registrar.domain(domain);
      if (r.where) registrar.where(r.where);
      if (r.middleware.length > 0) registrar.middleware(...r.middleware);
    }
  }
  return routes;
}

/** Every code file `registerFileRoutes` imports for a scan: controllers, `*.routes.ts`, `middleware.ts`, `route.ts` and Live components. */
export function routeScanFiles(scan: RouteScan): string[] {
  const files = new Set<string>();
  for (const folder of scan.folders) {
    for (const file of [...folder.controllers, folder.routesConfig, folder.middleware, folder.routeFile, folder.live]) if (file) files.add(file);
  }
  return [...files].sort();
}

/**
 * The same scan under another root. A scan taken at build time (paths relative to `from`) can be stored, then
 * placed at any `to` when the app runs without the source tree, for example inside a single-file binary.
 */
export function relocateRouteScan(scan: RouteScan, from: string, to: string): RouteScan {
  const move = (path: string): string => (path === from ? to : path.startsWith(from + sep) || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path);
  const optional = (path: string | undefined) => (path === undefined ? undefined : move(path));
  return {
    root: move(scan.root),
    stray: scan.stray.map(move),
    folders: scan.folders.map((folder) => ({
      ...folder,
      dir: move(folder.dir),
      controller: optional(folder.controller),
      controllers: folder.controllers.map(move),
      pages: Object.fromEntries(Object.entries(folder.pages).map(([key, file]) => [key, move(file)])),
      views: Object.fromEntries(Object.entries(folder.views).map(([key, file]) => [key, move(file)])),
      requests: optional(folder.requests),
      policy: optional(folder.policy),
      layout: optional(folder.layout),
      middleware: optional(folder.middleware),
      routesConfig: optional(folder.routesConfig),
      routeFile: optional(folder.routeFile),
      live: optional(folder.live),
    })),
  };
}

/**
 * Route entries of an app: the route tree in `routes/` (when it holds route folders), or for a classic app
 * the `routes/web.ts` and `routes/api.ts` it writes by hand (`api.ts` gets the `api` group and `/api`).
 */
export function routeEntries(root: string): string[] {
  const routes = join(root, "routes");
  if (!existsSync(routes)) return [];
  if (readdirSync(routes).some((e) => statSync(join(routes, e)).isDirectory() && !/^[A-Z_.]/.test(e))) return [routes];
  return ["web.ts", "api.ts"].map((file) => join(routes, file)).filter((file) => existsSync(file));
}

/** The route tree folder of an app (`routes/`), when it has one; a classic app has route files instead. */
export function routeTreeOf(root: string): string | undefined {
  return routeEntries(root).find((entry) => statSync(entry).isDirectory());
}

/**
 * Everything that runs for a route: its own middleware, then what its controller declares with
 * `@Middleware`. Used to list the full chain; the kernel merges the same two lists per request.
 */
export function fullMiddleware(route: RouteDefinition): RouteMiddleware[] {
  const own = route.middleware as RouteMiddleware[];
  if (!Array.isArray(route.action)) return own;
  const [controller, method] = route.action as [Function, string];
  const declared = controllerMiddlewareOf(controller, method).map((m) => middlewareAliasOf(m) ?? m);
  return [...own, ...(declared as RouteMiddleware[])];
}
