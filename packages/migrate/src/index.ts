export type PhpFileKind =
  | "controller"
  | "model"
  | "migration"
  | "middleware"
  | "job"
  | "request"
  | "policy"
  | "unknown";

export type PhpFileInfo = {
  path: string;
  kind: PhpFileKind;
  className?: string;
  methods: string[];
};

export type CompatibilityIssue = {
  file: string;
  line?: number;
  feature: string;
  message: string;
  supported: boolean;
};

export type CompatibilityReport = {
  root: string;
  files: PhpFileInfo[];
  issues: CompatibilityIssue[];
  summary: {
    totalFiles: number;
    supported: number;
    unsupported: number;
  };
};

const UNSUPPORTED_PATTERNS: { feature: string; pattern: RegExp; message: string }[] = [
  {
    feature: "facade",
    pattern: /\b(?:Auth|DB|Cache|Queue|Mail|Event|Storage|Log|Http)::/,
    message: "PHP facades need Bunyad facade imports or helpers.",
  },
  {
    feature: "eloquent-relationship",
    pattern: /\b(?:hasMany|belongsTo|hasOne|belongsToMany|morphMany)\(/,
    message: "Verify ORM relationship API parity manually.",
  },
  {
    feature: "php-attribute",
    pattern: /#\[(?:Test|Route|Middleware)/,
    message: "Map PHP attributes to TypeScript decorators (@test(), etc.).",
  },
  {
    feature: "blade",
    pattern: /@(?:extends|section|yield|include|foreach|if)\b/,
    message: "Convert Blade to .view templates (similar syntax, no $).",
  },
];

export function classifyPhpFile(path: string): PhpFileKind {
  const normalized = path.replace(/\\/g, "/");
  if (/(?:^|\/)Http\/Controllers\//.test(normalized)) return "controller";
  if (/(?:^|\/)Http\/Requests\//.test(normalized)) return "request";
  if (/(?:^|\/)Policies\//.test(normalized)) return "policy";
  if (/(?:^|\/)Models\//.test(normalized)) return "model";
  if (/(?:^|\/)database\/migrations\//.test(normalized)) return "migration";
  if (/(?:^|\/)Http\/Middleware\//.test(normalized)) return "middleware";
  if (/(?:^|\/)Jobs\//.test(normalized)) return "job";
  return "unknown";
}

export function parsePhpClass(source: string): {
  className?: string;
  methods: string[];
} {
  const classMatch = source.match(
    /(?:final\s+)?class\s+(\w+)/,
  );
  const methods = [...source.matchAll(/(?:public|protected|private)\s+function\s+(\w+)\s*\(/g)]
    .map((match) => match[1]!)
    .filter((name) => name !== "__construct");
  return { className: classMatch?.[1], methods };
}

export function analyzePhpSource(path: string, source: string): PhpFileInfo {
  const { className, methods } = parsePhpClass(source);
  return {
    path,
    kind: classifyPhpFile(path),
    className,
    methods,
  };
}

export function findCompatibilityIssues(
  path: string,
  source: string,
): CompatibilityIssue[] {
  const lines = source.split("\n");
  const issues: CompatibilityIssue[] = [];

  for (const rule of UNSUPPORTED_PATTERNS) {
    lines.forEach((line, index) => {
      if (rule.pattern.test(line)) {
        issues.push({
          file: path,
          line: index + 1,
          feature: rule.feature,
          message: rule.message,
          supported: false,
        });
      }
    });
  }

  return issues;
}

export async function scanPhpDirectory(root: string): Promise<CompatibilityReport> {
  const { readdir } = await import("node:fs/promises");
  const { join, relative } = await import("node:path");

  const files: PhpFileInfo[] = [];
  const issues: CompatibilityIssue[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "vendor" || entry.name === "node_modules") continue;
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith(".php")) continue;
      const rel = relative(root, full);
      const source = await Bun.file(full).text();
      files.push(analyzePhpSource(rel, source));
      issues.push(...findCompatibilityIssues(rel, source));
    }
  }

  await walk(root);

  return {
    root,
    files,
    issues,
    summary: {
      totalFiles: files.length,
      supported: files.length - new Set(issues.map((i) => i.file)).size,
      unsupported: new Set(issues.map((i) => i.file)).size,
    },
  };
}

export function formatReport(report: CompatibilityReport): string {
  const lines = [
    `Bunyad migration report — ${report.root}`,
    `Files: ${report.summary.totalFiles} PHP`,
    `Needs review: ${report.summary.unsupported} file(s) with flagged patterns`,
    "",
  ];

  if (report.issues.length === 0) {
    lines.push("No unsupported patterns detected (manual review still recommended).");
    return lines.join("\n");
  }

  lines.push("Issues:");
  for (const issue of report.issues) {
    const at = issue.line ? `:${issue.line}` : "";
    lines.push(`  ${issue.file}${at} [${issue.feature}] ${issue.message}`);
  }

  lines.push("");
  lines.push("Controllers:");
  for (const file of report.files.filter((f) => f.kind === "controller")) {
    lines.push(
      `  ${file.path} → ${file.className ?? "?"} (${file.methods.join(", ") || "no methods"})`,
    );
  }

  return lines.join("\n");
}

export function convertControllerStub(source: string, filePath = "Controller.php"): string {
  const info = analyzePhpSource(filePath, source);
  const className = info.className ?? "ExampleController";
  const methods = info.methods.length
    ? info.methods
    : ["index"];

  const body = methods
    .map((method) => {
      return `  async ${method}(request: Request) {
    // TODO: migrate from PHP ${className}::${method}()
    return json({ todo: "${method}" });
  }`;
    })
    .join("\n\n");

  return `import type { Request } from "@bunyad/http";
import { json } from "@bunyad/http";

/** TODO: migrated from ${filePath} */
export default class ${className} {
${body}
}
`;
}

export function convertModelStub(source: string, filePath = "Model.php"): string {
  const info = analyzePhpSource(filePath, source);
  const className = info.className ?? "Example";
  const tableMatch = source.match(/\$table\s*=\s*['"](\w+)['"]/);
  const table = tableMatch?.[1] ?? `${className.toLowerCase()}s`;
  const fillableMatch = source.match(/\$fillable\s*=\s*\[([^\]]+)\]/);
  const fields = fillableMatch
    ? fillableMatch[1]!
        .split(",")
        .map((part) => part.replace(/['"\s]/g, ""))
        .filter(Boolean)
    : ["id"];

  const declarations = fields
    .map((field) => `  declare ${field}: string;`)
    .join("\n");

  return `import { Model } from "@bunyad/orm";

/** TODO: migrated from ${filePath} */
export default class ${className} extends Model {
  static table = "${table}";
${declarations}
}
`;
}

export function convertRoutesStub(source: string, filePath = "web.php"): string {
  const lines = source.split("\n");
  const out: string[] = [
    'import { Route, type Router } from "@bunyad/router";',
    "",
    "/** TODO: migrated from " + filePath + " */",
    "export default function (router: Router = Route): void {",
  ];

  let groupDepth = 0;
  const indent = () => "  ".repeat(1 + groupDepth);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("<?") || trimmed.startsWith("use ")) continue;

    // Route::middleware('auth')->prefix('admin')->name('admin.')->group(function () {
    const groupOpen = trimmed.match(
      /^Route::(?:middleware|prefix|name|domain)\(/,
    );
    if (groupOpen && /->group\s*\(/.test(trimmed)) {
      const middleware = [
        ...trimmed.matchAll(/->middleware\(\s*\[([^\]]+)\]\s*\)/g),
        ...trimmed.matchAll(/Route::middleware\(\s*\[([^\]]+)\]\s*\)/g),
        ...trimmed.matchAll(/->middleware\(\s*['"]([^'"]+)['"]\s*\)/g),
        ...trimmed.matchAll(/Route::middleware\(\s*['"]([^'"]+)['"]\s*\)/g),
      ];
      const prefix =
        trimmed.match(/->prefix\(\s*['"]([^'"]+)['"]\s*\)/)?.[1] ??
        trimmed.match(/Route::prefix\(\s*['"]([^'"]+)['"]\s*\)/)?.[1];
      const name =
        trimmed.match(/->name\(\s*['"]([^'"]+)['"]\s*\)/)?.[1] ??
        trimmed.match(/Route::name\(\s*['"]([^'"]+)['"]\s*\)/)?.[1];

      const opts: string[] = [];
      if (middleware.length > 0) {
        const parts = middleware.flatMap((m) =>
          m[1]!.includes(",") || m[1]!.includes("'") || m[1]!.includes('"')
            ? m[1]!
                .split(",")
                .map((p) => p.replace(/['"\s]/g, ""))
                .filter(Boolean)
            : [m[1]!.replace(/['"\s]/g, "")],
        );
        const unique = [...new Set(parts)];
        opts.push(
          `middleware: [${unique.map((m) => JSON.stringify(m)).join(", ")}]`,
        );
      }
      if (prefix) opts.push(`prefix: ${JSON.stringify(prefix)}`);
      if (name) opts.push(`name: ${JSON.stringify(name)}`);

      out.push(
        `${indent()}Route.group({ ${opts.join(", ")} }, () => {`,
      );
      groupDepth += 1;
      continue;
    }

    if (trimmed === "});" && groupDepth > 0) {
      groupDepth -= 1;
      out.push(`${indent()}});`);
      continue;
    }

    const verbMatch = trimmed.match(
      /Route::(get|post|put|patch|delete|options)\(\s*['"]([^'"]+)['"]\s*,\s*\[(\w+)::class,\s*['"](\w+)['"]\]/,
    );
    if (verbMatch) {
      out.push(
        `${indent()}Route.${verbMatch[1]}("${verbMatch[2]}", [${verbMatch[3]}, "${verbMatch[4]}"]);`,
      );
      continue;
    }

    const resource = trimmed.match(
      /Route::(apiResource|resource)\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)::class/,
    );
    if (resource) {
      const isApi = resource[1] === "apiResource";
      out.push(
        `${indent()}Route.${isApi ? "apiResource" : "resource"}("${resource[2]}", ${resource[3]});`,
      );
      continue;
    }

    if (trimmed.startsWith("Route::")) {
      out.push(`${indent()}// TODO: ${trimmed}`);
    }
  }

  while (groupDepth > 0) {
    groupDepth -= 1;
    out.push(`${indent()}});`);
  }

  out.push("}");
  return out.join("\n");
}

export function convertFormRequestStub(
  source: string,
  filePath = "Request.php",
): string {
  const info = analyzePhpSource(filePath, source);
  const className = info.className ?? "ExampleRequest";

  const authorizeTrue = /function\s+authorize\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{[^}]*return\s+true/s.test(
    source,
  );
  const authorizeFalse = /function\s+authorize\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{[^}]*return\s+false/s.test(
    source,
  );

  const rulesBody = extractPhpArrayReturn(source, "rules");
  const rulesTs = rulesBody
    ? phpAssocArrayToTs(rulesBody)
    : "{\n      // field: \"required|string\",\n    }";

  return `import { FormRequest } from "@bunyad/http";

/** TODO: migrated from ${filePath} */
export default class ${className} extends FormRequest {
  authorize() {
    return ${authorizeFalse && !authorizeTrue ? "false" : "true"};
  }

  rules() {
    return ${rulesTs};
  }
}
`;
}

export function convertPolicyStub(
  source: string,
  filePath = "Policy.php",
): string {
  const info = analyzePhpSource(filePath, source);
  const className = info.className ?? "ExamplePolicy";
  const modelGuess =
    className.replace(/Policy$/i, "") ||
    source.match(/function\s+\w+\s*\([^)]*?(\w+)\s+\$\w+/)?.[1] ||
    "Model";

  const methods = info.methods.length
    ? info.methods
    : ["view", "create", "update", "delete"];

  const body = methods
    .map((method) => {
      if (method === "create") {
        return `  ${method}(user: GateUser) {
    return user != null;
  }`;
      }
      return `  ${method}(user: GateUser, model: ${modelGuess}) {
    // TODO: migrate from PHP ${className}::${method}()
    return user != null;
  }`;
    })
    .join("\n\n");

  return `import type { GateUser } from "@bunyad/auth";
import type ${modelGuess} from "../Models/${modelGuess}.ts";

/** TODO: migrated from ${filePath} */
export default class ${className} {
${body}
}
`;
}

/** Extract the raw PHP array contents from `return [...];` inside a named method. */
function extractPhpArrayReturn(source: string, method: string): string | null {
  const re = new RegExp(
    `function\\s+${method}\\s*\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\s*\\}`,
  );
  const block = source.match(re)?.[1];
  if (!block) return null;
  const arr = block.match(/return\s*\[([\s\S]*?)\];/);
  return arr?.[1] ?? null;
}

/** Convert simple PHP `'key' => 'rule'` pairs to a TS object literal. */
function phpAssocArrayToTs(inner: string): string {
  const entries: string[] = [];
  for (const match of inner.matchAll(
    /['"](\w+)['"]\s*=>\s*['"]([^'"]+)['"]/g,
  )) {
    entries.push(`      ${match[1]}: "${match[2]}",`);
  }
  if (entries.length === 0) {
    return `{\n      // TODO: migrate rules from PHP\n    }`;
  }
  return `{\n${entries.join("\n")}\n    }`;
}

export function convertBladeToView(source: string, filePath = "page.blade.php"): string {
  let view = source;
  view = view.replace(/<\?php[\s\S]*?\?>/g, "");
  view = view.replace(/\{\{\s*\$(\w+)\s*\}\}/g, "{{ $1 }}");
  view = view.replace(/@if\s*\(\s*\$(\w+)/g, "@if($1");
  view = view.replace(/@foreach\s*\(\s*\$(\w+)/g, "@foreach($1");
  view = view.replace(/@error\s*\(\s*['"](\w+)['"]\s*\)/g, "@error('$1')");

  const outName = filePath.replace(/\.blade\.php$/i, ".view");
  return `{{-- TODO: migrated from ${filePath} → save as ${outName} --}}\n${view.trim()}\n`;
}

export function convertMigrationStub(
  source: string,
  filePath = "migration.php",
): string {
  const base =
    filePath
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.replace(/\.php$/i, "") ?? "migration";
  const hasDown = /\bfunction\s+down\s*\(/.test(source);
  return `import type { Schema } from "@bunyad/database";

/** TODO: migrated from ${filePath} — stub only; fill Schema from PHP up()/down(). */
export async function up(schema: Schema): Promise<void> {
  // TODO: migrate Schema:: from PHP ${base}::up()
  await schema.raw("-- TODO");
}

export async function down(schema: Schema): Promise<void> {
  ${hasDown ? `// TODO: migrate Schema:: from PHP ${base}::down()` : "// no down() in PHP source"}
  await schema.raw("-- TODO");
}
`;
}

export function convertMiddlewareStub(
  _source: string,
  filePath = "Middleware.php",
): string {
  const className =
    parsePhpClass(_source).className ??
    filePath.replace(/\\/g, "/").split("/").pop()?.replace(/\.php$/i, "") ??
    "ExampleMiddleware";
  return `import type { Request } from "@bunyad/http";

/** TODO: migrated from ${filePath} */
export default class ${className} {
  async handle(request: Request, next: (request: Request) => Promise<Response>) {
    // TODO: migrate from PHP ${className}::handle()
    return next(request);
  }
}
`;
}

export function convertJobStub(
  _source: string,
  filePath = "Job.php",
): string {
  const className =
    parsePhpClass(_source).className ??
    filePath.replace(/\\/g, "/").split("/").pop()?.replace(/\.php$/i, "") ??
    "ExampleJob";
  return `import { Job } from "@bunyad/queue";

/** TODO: migrated from ${filePath} */
export default class ${className} extends Job {
  async handle(): Promise<void> {
    // TODO: migrate from PHP ${className}::handle()
  }
}
`;
}

/** Pick the best converter for a PHP/Blade path. Stub bodies only — not a semantic port. */
export function convertPhpFile(source: string, filePath: string): string {
  if (/\.blade\.php$/i.test(filePath)) {
    return convertBladeToView(source, filePath);
  }
  const kind = classifyPhpFile(filePath);
  if (kind === "model") return convertModelStub(source, filePath);
  if (kind === "request") return convertFormRequestStub(source, filePath);
  if (kind === "policy") return convertPolicyStub(source, filePath);
  if (kind === "migration") return convertMigrationStub(source, filePath);
  if (kind === "middleware") return convertMiddlewareStub(source, filePath);
  if (kind === "job") return convertJobStub(source, filePath);
  if (filePath.includes("routes/")) return convertRoutesStub(source, filePath);
  return convertControllerStub(source, filePath);
}
