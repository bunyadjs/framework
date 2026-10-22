/**
 * `bunyad build` and `bunyad dev` for apps with an Inertia frontend (React, Vue or Svelte) and no `scripts/`
 * of their own.
 *
 * Pages are found, not listed: `virtual:pages` maps every `*Page` view in the route tree to a lazy import,
 * together with the `*Layout` of each folder above it, so each page and layout loads in its own chunk.
 * The browser entry is built in; add `routes/app.tsx` (or `app.ts`) to change it.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Glob, type BunPlugin } from "bun";

export type Renderer = "react" | "vue" | "svelte";

/** The renderer an app uses, from its `package.json` dependencies. */
export function rendererOf(root: string): Renderer | undefined {
  try {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.devDependencies, ...pkg.dependencies };
    if (deps["@inertiajs/react"]) return "react";
    if (deps["@inertiajs/vue3"]) return "vue";
    if (deps["@inertiajs/svelte"]) return "svelte";
  } catch {
    // no package.json
  }
  return undefined;
}

const EXTENSION: Record<Renderer, string> = { react: "tsx", vue: "vue", svelte: "svelte" };
const ENTRY_EXTENSION: Record<Renderer, string> = { react: "tsx", vue: "ts", svelte: "ts" };

/** The route tree: `routes/` when it holds route folders, . */
function routeTree(root: string): string {
  const routes = resolve(root, "routes");
  return routes;
}

/** The browser entry: the app's own (`routes/app.*`, or `resources/js/app.*` in older apps), else the default. */
function entryFile(root: string, renderer: Renderer): string {
  const ext = ENTRY_EXTENSION[renderer];
  for (const own of [`routes/app.${ext}`, `resources/js/app.${ext}`]) {
    if (existsSync(resolve(root, own))) return resolve(root, own);
  }
  const generated = resolve(root, `.bunyad/entry.${ext}`);
  mkdirSync(resolve(root, ".bunyad"), { recursive: true });
  writeFileSync(generated, DEFAULT_ENTRY[renderer]);
  return generated;
}

/** The stylesheet to build: `routes/app.css`, or `resources/css/app.css` in older apps. */
function stylesheet(root: string): string {
  return existsSync(resolve(root, "routes/app.css")) ? "routes/app.css" : "resources/css/app.css";
}

/** Whether the stylesheet uses Tailwind; a plain one is copied to `public/build/app.css` as it is. */
function usesTailwind(root: string): boolean {
  return /tailwindcss/.test(readFileSync(resolve(root, stylesheet(root)), "utf8"));
}

/** Build the stylesheet once into `public/build/app.css`: Tailwind when it imports it, else a copy. Returns the exit code. */
function buildStylesheet(root: string): number {
  if (usesTailwind(root)) {
    return Bun.spawnSync(["bunx", "tailwindcss", "-i", stylesheet(root), "-o", "public/build/app.css", "--minify"], { cwd: root, stdout: "inherit", stderr: "inherit" }).exitCode;
  }
  mkdirSync(resolve(root, "public/build"), { recursive: true });
  copyFileSync(resolve(root, stylesheet(root)), resolve(root, "public/build/app.css"));
  return 0;
}

/** Whether the app has a Tailwind stylesheet to build (server-rendered apps have only that). */
export function hasStylesheet(root: string): boolean {
  return existsSync(resolve(root, "routes/app.css")) || existsSync(resolve(root, "resources/css/app.css"));
}

export function hasBuiltInFrontend(root: string): boolean {
  const renderer = rendererOf(root);
  if (!renderer) return false;
  const ext = ENTRY_EXTENSION[renderer];
  if (existsSync(resolve(root, `resources/js/app.${ext}`)) || existsSync(resolve(root, `routes/app.${ext}`))) return true;
  const tree = routeTree(root);
  return existsSync(tree) && new Glob(`**/*Page.${EXTENSION[renderer]}`).scanSync({ cwd: tree }).next().done === false;
}

const CHAIN = `const chain = layouts.slice(Math.max(layouts.map((layout: any) => layout.reset === true).lastIndexOf(true), 0)).map((layout: any) => layout.default);`;

/**
 * What every Inertia app does in the browser; add `routes/app.tsx` (React) or `routes/app.ts` to change it.
 * A page is wrapped in the layout of its folder and of every folder above it (outermost first), and each layout
 * receives the page's `export const meta` (an object, or a function of the page props). A layout that exports
 * `reset = true` starts a new chain.
 */
const DEFAULT_ENTRY: Record<Renderer, string> = {
  react: `import { createInertiaApp } from "@inertiajs/react";
import { createElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { pages } from "virtual:pages";

const appName = document.querySelector<HTMLMetaElement>('meta[name="application-name"]')?.content ?? "";

void createInertiaApp({
  title: (title) => (title ? \`\${title} - \${appName}\` : appName),
  resolve: async (name) => {
    const entry = pages[name];
    if (!entry) throw new Error(\`Page not found: \${name}\`);
    const [mod, ...layouts] = await Promise.all([entry.page(), ...entry.layouts.map((load) => load())]);
    const Page = mod.default as any;
    ${CHAIN}
    // A page that sets its own \`layout\` (or \`false\`) keeps it.
    if (Page.layout === undefined && chain.length > 0) {
      Page.layout = (page: any) => {
        const meta = typeof (mod as any).meta === "function" ? (mod as any).meta(page.props) : ((mod as any).meta ?? {});
        return chain.reduceRight((children: unknown, Layout: any) => createElement(Layout, { meta }, children), page);
      };
    }
    return Page;
  },
  setup({ el, App, props }) {
    // The first page arrives rendered on the server; hydrate it.
    if (el!.hasAttribute("data-server-rendered")) hydrateRoot(el!, <App {...props} />);
    else createRoot(el!).render(<App {...props} />);
  },
  progress: { color: "var(--color-primary)" },
});
`,
  vue: `import { createInertiaApp, usePage } from "@inertiajs/vue3";
import { createApp, createSSRApp, defineComponent, h } from "vue";
import { pages } from "virtual:pages";

const appName = document.querySelector<HTMLMetaElement>('meta[name="application-name"]')?.content ?? "";

void createInertiaApp({
  title: (title) => (title ? title + " - " + appName : appName),
  resolve: async (name) => {
    const entry = pages[name];
    if (!entry) throw new Error("Page not found: " + name);
    const [mod, ...layouts] = await Promise.all([entry.page(), ...entry.layouts.map((load) => load())]);
    const Page = mod.default as any;
    ${CHAIN}
    // A page that sets its own \`layout\` keeps it.
    if (Page.layout === undefined && chain.length > 0) {
      Page.layout = chain.map((Layout: any) =>
        defineComponent({
          setup(_props, { slots }) {
            const page = usePage();
            const meta = (mod as any).meta;
            return () => h(Layout, { meta: typeof meta === "function" ? meta(page.props) : (meta ?? {}) }, slots);
          },
        }),
      );
    }
    return Page;
  },
  setup({ el, App, props, plugin }) {
    // The first page arrives rendered on the server; hydrate it.
    const create = el!.hasAttribute("data-server-rendered") ? createSSRApp : createApp;
    create({ render: () => h(App, props) }).use(plugin).mount(el!);
  },
  progress: { color: "var(--color-primary)" },
});
`,
  svelte: `import { createInertiaApp } from "@inertiajs/svelte";
import { hydrate, mount } from "svelte";
import { pages } from "virtual:pages";

void createInertiaApp({
  resolve: async (name) => {
    const entry = pages[name];
    if (!entry) throw new Error("Page not found: " + name);
    const [mod, ...layouts] = await Promise.all([entry.page(), ...entry.layouts.map((load) => load())]);
    ${CHAIN}
    // The Svelte adapter takes the module (\`default\`, and an optional \`layout\`); a page that sets its own keeps it.
    if ((mod as any).layout !== undefined || chain.length === 0) return mod;
    const meta = (mod as any).meta;
    return {
      default: mod.default,
      // Named functions with a prototype: the adapter takes those for components, not render functions.
      layout: chain.map((Layout: any) =>
        function PageLayout(anchor: unknown, props: any) {
          return Layout(anchor, {
            get meta() {
              return typeof meta === "function" ? meta(props) : (meta ?? {});
            },
            get children() {
              return props.children;
            },
          });
        },
      ),
    };
  },
  setup({ el, App, props }) {
    // The first page arrives rendered on the server; hydrate it.
    if (el!.hasAttribute("data-server-rendered")) hydrate(App, { target: el!, props });
    else mount(App, { target: el!, props });
  },
  progress: { color: "var(--color-primary)" },
});
`,
};

/** The layout of each folder from `tree` down to the page's folder, outermost first (one `*Layout` per folder). */
function layoutsFor(tree: string, pageFile: string, ext: string): string[] {
  const parts = pageFile.split("/").slice(0, -1);
  const pattern = new RegExp(`Layout\\.${ext}$`);
  const found: string[] = [];
  for (let i = 0; i <= parts.length; i++) {
    const dir = resolve(tree, ...parts.slice(0, i));
    const layout = readdirSync(dir).find((entry) => pattern.test(entry) && !entry.startsWith("_"));
    if (layout) found.push(resolve(dir, layout));
  }
  return found;
}

function pagesPlugin(tree: string, ext: string): BunPlugin {
  return {
    name: "inertia-pages",
    setup(build) {
      build.onResolve({ filter: /^virtual:pages$/ }, () => ({ path: "pages", namespace: "inertia-pages" }));
      build.onLoad({ filter: /.*/, namespace: "inertia-pages" }, async () => {
        const entries: string[] = [];
        for await (const file of new Glob(`**/*Page.${ext}`).scan(tree)) {
          const name = file.replace(new RegExp(`\\.${ext}$`), "").replaceAll("\\", "/");
          const layouts = layoutsFor(tree, file, ext).map((path) => `() => import(${JSON.stringify(path)})`);
          entries.push(`  ${JSON.stringify(name)}: { page: () => import(${JSON.stringify(resolve(tree, file))}), layouts: [${layouts.join(", ")}] },`);
        }
        return { contents: `export const pages = {\n${entries.sort().join("\n")}\n};\n`, loader: "ts" };
      });
    },
  };
}

/** Single-file components: `<script setup>` with the template compiled inline. Style with Tailwind classes. */
export async function vuePlugin(root: string): Promise<BunPlugin> {
  const { createHash } = await import("node:crypto");
  const sfc = (await import(Bun.resolveSync("@vue/compiler-sfc", root))) as any;
  return {
    name: "vue-sfc",
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
        const { descriptor, errors } = sfc.parse(await Bun.file(path).text(), { filename: path });
        if (errors.length > 0) throw errors[0];
        if (descriptor.styles.length > 0) {
          throw new Error(`${relative(process.cwd(), path)}: <style> blocks are not bundled; use Tailwind classes.`);
        }
        const id = createHash("sha256").update(path).digest("hex").slice(0, 8);
        const script = sfc.compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: "__sfc__" });
        return {
          contents: `${script.content}\nexport default __sfc__;\n`,
          loader: descriptor.scriptSetup?.lang === "ts" || descriptor.script?.lang === "ts" ? "ts" : "js",
        };
      });
    },
  };
}

async function frameworkPlugins(root: string, renderer: Renderer, production: boolean): Promise<BunPlugin[]> {
  if (renderer === "vue") return [await vuePlugin(root)];
  if (renderer === "svelte") {
    const { SveltePlugin } = (await import(Bun.resolveSync("bun-plugin-svelte", root))) as { SveltePlugin: (options: { development?: boolean }) => BunPlugin };
    return [SveltePlugin({ development: !production })];
  }
  return [];
}

async function bundle(root: string, tree: string, renderer: Renderer): Promise<boolean> {
  const production = process.env.NODE_ENV === "production";
  const started = performance.now();
  const result = await Bun.build({
    entrypoints: [entryFile(root, renderer)],
    outdir: resolve(root, "public/build"),
    target: "browser",
    format: "esm",
    splitting: true,
    minify: production,
    sourcemap: production ? "none" : "linked",
    naming: { entry: "app.js", chunk: "chunks/[name]-[hash].js", asset: "assets/[name]-[hash].[ext]" },
    define: {
      "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
      ...(renderer === "vue" ? { __VUE_OPTIONS_API__: "true", __VUE_PROD_DEVTOOLS__: "false", __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false" } : {}),
    },
    plugins: [pagesPlugin(tree, EXTENSION[renderer]), ...(await frameworkPlugins(root, renderer, production))],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    return false;
  }
  console.log(`bundled ${result.outputs.length} files in ${Math.round(performance.now() - started)}ms`);
  return true;
}

/** Bundle the frontend and the stylesheet into `public/build`; with `watch`, rebuild the bundle on changes. */
export async function buildFrontend(root: string, options: { watch?: boolean } = {}): Promise<boolean> {
  const tree = routeTree(root);
  const renderer = rendererOf(root) ?? "react";
  // A server-rendered app (`.view` pages) has only the stylesheet to build.
  if (!hasBuiltInFrontend(root)) {
    if (options.watch) return new Promise(() => {});
    return buildStylesheet(root) === 0;
  }
  if (options.watch) {
    await bundle(root, tree, renderer);
    // A plain stylesheet is copied again when it changes (Tailwind has its own watcher in `bunyad dev`).
    if (!usesTailwind(root)) {
      buildStylesheet(root);
      watch(resolve(root, stylesheet(root)), () => buildStylesheet(root));
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    for (const dir of [resolve(root, "resources/js"), tree].filter((d) => existsSync(d))) {
      watch(dir, { recursive: true }, (_event, file) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          console.log(`changed ${relative(root, resolve(dir, String(file)))}`);
          void bundle(root, tree, renderer);
        }, 50);
      });
    }
    return new Promise(() => {});
  }
  return (await bundle(root, tree, renderer)) && buildStylesheet(root) === 0;
}

type Task = { name: string; color: string; cmd: string[]; quiet?: RegExp };

/**
 * The development loop: the server with hot reload, the bundle rebuilding as the frontend changes,
 * typed routes and props regenerating, and Tailwind rebuilding `public/build/app.css`.
 * Each line is prefixed with its process. Ctrl+C, or any process exiting, stops them all.
 */
export async function runDev(root: string, cli: string[]): Promise<number> {
  const frontend = hasBuiltInFrontend(root);
  const tasks: Task[] = [
    { name: "server", color: "\x1b[34m", cmd: [...cli, "serve", "--hot"] },
    ...(frontend
      ? [
          { name: "js", color: "\x1b[33m", cmd: [...cli, "build", "--watch"] },
          { name: "types", color: "\x1b[36m", cmd: [...cli, "types:generate", "--watch"] },
        ]
      : []),
    ...(usesTailwind(root)
      ? [
          {
            name: "css",
            color: "\x1b[35m",
            cmd: ["bunx", "tailwindcss", "-i", stylesheet(root), "-o", "public/build/app.css", "--watch=always"],
            quiet: /^(≈ tailwindcss|\/\*! 🌼 daisyUI|Done in)/,
          },
        ]
      : []),
  ];
  const width = Math.max(...tasks.map((task) => task.name.length));
  const prefix = (task: Task) => `${task.color}[${task.name}]\x1b[0m${" ".repeat(width - task.name.length)} `;

  async function pipe(task: Task, stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        const plain = Bun.stripANSI(line).trim();
        if (plain === "" || task.quiet?.test(plain)) continue;
        process.stdout.write(`${prefix(task)}${line}\n`);
      }
    }
  }

  const children = tasks.map((task) => {
    const child = Bun.spawn(task.cmd, { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "1" } });
    void pipe(task, child.stdout);
    void pipe(task, child.stderr);
    return child;
  });

  let stopping = false;
  const stop = async (code = 0): Promise<number> => {
    if (stopping) return code;
    stopping = true;
    for (const child of children) child.kill();
    await Promise.race([Promise.all(children.map((child) => child.exited)), Bun.sleep(3000)]);
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => void stop());
  return stop(await Promise.race(children.map((child) => child.exited)));
}
