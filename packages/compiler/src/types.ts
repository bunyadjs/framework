export type Diagnostic = {
  code: string;
  message: string;
  file?: string;
  line?: number;
  severity?: "error" | "warning";
};

export type ManifestV1 = {
  version: 1;
  app: string;
  generatedAt: string;
  entries: Record<string, string>;
  modules: Record<string, string>;
  meta: Record<string, unknown>;
  plugins: string[];
};

export type AnalyzeContext = {
  root: string;
  outDir: string;
  diagnostics: Diagnostic[];
  ir: Map<string, unknown>;
};

export type GenerateContext = AnalyzeContext & {
  writeModule(name: string, fileName: string, contents: string): void;
  setManifestModule(name: string, relativePath: string): void;
  setManifestMeta(plugin: string, data: unknown): void;
  setEntry(name: string, relativePath: string): void;
};

export type CompilerPlugin = {
  name: string;
  analyze?(ctx: AnalyzeContext): void | Promise<void>;
  generate?(ctx: GenerateContext): void | Promise<void>;
};

export type CompileOptions = {
  root: string;
  outDir?: string;
  appName?: string;
  plugins: CompilerPlugin[];
  /**
   * Absolute path to a module that registers routes on the default Route.
   * @deprecated Prefer `routesEntries` for web + api.
   */
  routesEntry?: string;
  /** Absolute paths to route modules (web.ts, api.ts): side-effect, default export, or registerRoutes BC. */
  routesEntries?: string[];
  /**
   * Emit `router.optimize()` (radix matcher) in compiled routes.
   * Also set via CLI `bunyad compile --optimize`.
   */
  optimize?: boolean;
  /** Paths used when generating the production server. */
  bootstrap: {
    applicationModule: string;
  };
};
