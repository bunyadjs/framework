import { existsSync } from "node:fs";
import { basename } from "node:path";
import { userProviderModel, type AuthConfig } from "@bunyad/auth";
import type { CompilerPlugin } from "../types.ts";

type DiscoveryFile = {
  file: string;
  ident: string;
  name: string;
};

type DiscoveryIR = {
  live: DiscoveryFile[];
  mailables: DiscoveryFile[];
  viewComponents: DiscoveryFile[];
  policies: Array<DiscoveryFile & { modelFile: string; modelIdent: string }>;
  user?: DiscoveryFile;
  token?: DiscoveryFile;
  channels?: DiscoveryFile;
};

function pascalToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function rel(fromFile: string, toFile: string): string {
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

function ident(prefix: string, value: string): string {
  return `${prefix}_${value.replaceAll(/[^a-zA-Z0-9]/g, "_")}`;
}

function dottedKebabName(file: string, root: string): string {
  const relPath = file
    .slice(root.length)
    .replace(/^[\\/]/, "")
    .replace(/\.(ts|tsx|js|jsx)$/, "");
  return relPath
    .split(/[\\/]/)
    .filter(Boolean)
    .map(pascalToKebab)
    .join(".");
}

async function listFiles(cwd: string, pattern: string): Promise<string[]> {
  if (!existsSync(cwd)) return [];
  const files: string[] = [];
  const glob = new Bun.Glob(pattern);
  for await (const file of glob.scan({ cwd, absolute: true })) {
    const name = basename(file);
    if (name.startsWith("index.")) continue;
    files.push(file);
  }
  files.sort();
  return files;
}

/**
 * Emit `.build/discovery.ts` with static imports so compiled binaries include
 * Live components / mail / view / policy / auth classes.
 */
export function createDiscoveryPlugin(): CompilerPlugin {
  return {
    name: "discovery",

    async analyze(ctx) {
      const liveRoot = `${ctx.root}/app/Live`;
      const mailRoot = `${ctx.root}/app/Mail`;
      const viewRoot = `${ctx.root}/app/View/Components`;
      const policyRoot = `${ctx.root}/app/Policies`;

      const liveFiles = await listFiles(liveRoot, "**/*.{ts,tsx}");
      const mailFiles = await listFiles(mailRoot, "**/*.{ts,tsx}");
      const viewFiles = await listFiles(viewRoot, "**/*.{ts,tsx}");
      const policyFiles = await listFiles(policyRoot, "**/*.{ts,tsx}");

      const live: DiscoveryFile[] = liveFiles.map((file) => ({
        file,
        ident: ident("live", dottedKebabName(file, liveRoot)),
        name: dottedKebabName(file, liveRoot),
      }));

      const mailables: DiscoveryFile[] = mailFiles.map((file) => ({
        file,
        ident: ident("mail", basename(file).replace(/\.(ts|tsx)$/, "")),
        name: basename(file).replace(/\.(ts|tsx)$/, ""),
      }));

      const viewComponents: DiscoveryFile[] = viewFiles.map((file) => ({
        file,
        ident: ident("view", dottedKebabName(file, viewRoot)),
        name: dottedKebabName(file, viewRoot),
      }));

      const policies: DiscoveryIR["policies"] = [];
      for (const file of policyFiles) {
        const base = basename(file).replace(/\.(ts|tsx)$/, "");
        if (!base.endsWith("Policy") || base === "Policy") continue;
        const modelName = base.slice(0, -"Policy".length);
        const modelFile = `${ctx.root}/app/Models/${modelName}.ts`;
        if (!existsSync(modelFile)) continue;
        policies.push({
          file,
          ident: ident("policy", base),
          name: base,
          modelFile,
          modelIdent: ident("model", modelName),
        });
      }

      const authConfigFile = `${ctx.root}/config/auth.ts`;
      const authConfig = existsSync(authConfigFile)
        ? ((await import(authConfigFile)) as { default?: AuthConfig }).default
        : undefined;
      const userModel = userProviderModel(authConfig);
      const userFile = `${ctx.root}/app/Models/${userModel}.ts`;
      const tokenFile = `${ctx.root}/app/Models/PersonalAccessToken.ts`;
      const channelsFile = `${ctx.root}/routes/channels.ts`;
      const user = existsSync(userFile)
        ? { file: userFile, ident: `model_${userModel}`, name: userModel }
        : undefined;
      const token = existsSync(tokenFile)
        ? {
            file: tokenFile,
            ident: "model_PersonalAccessToken",
            name: "PersonalAccessToken",
          }
        : undefined;
      const channels = existsSync(channelsFile)
        ? {
            file: channelsFile,
            ident: "register_channels",
            name: "channels",
          }
        : undefined;

      const empty =
        live.length === 0 &&
        mailables.length === 0 &&
        viewComponents.length === 0 &&
        policies.length === 0 &&
        !user &&
        !token &&
        !channels;
      if (empty) return;

      ctx.ir.set("discovery", {
        live,
        mailables,
        viewComponents,
        policies,
        user,
        token,
        channels,
      } satisfies DiscoveryIR);
    },

    generate(ctx) {
      const ir = ctx.ir.get("discovery") as DiscoveryIR | undefined;
      if (!ir) return;

      const outFile = "discovery.ts";
      const outPath = `${ctx.outDir}/${outFile}`;
      const imports: string[] = [];
      const seen = new Set<string>();

      const addImport = (id: string, file: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        imports.push(
          `import ${id} from ${JSON.stringify(rel(outPath, file))};`,
        );
      };

      for (const item of ir.live) addImport(item.ident, item.file);
      for (const item of ir.mailables) addImport(item.ident, item.file);
      for (const item of ir.viewComponents) addImport(item.ident, item.file);
      for (const item of ir.policies) {
        addImport(item.ident, item.file);
        addImport(item.modelIdent, item.modelFile);
      }
      if (ir.user) addImport(ir.user.ident, ir.user.file);
      if (ir.token) addImport(ir.token.ident, ir.token.file);

      const namedImports: string[] = [];
      if (ir.channels) {
        namedImports.push(
          `import { registerChannels as ${ir.channels.ident} } from ${JSON.stringify(rel(outPath, ir.channels.file))};`,
        );
      }

      const liveEntries = ir.live
        .map((item) => `    [${JSON.stringify(item.name)}, ${item.ident}],`)
        .join("\n");
      const mailableEntries = ir.mailables.map((item) => item.ident).join(", ");
      const viewEntries = ir.viewComponents
        .map((item) => `    [${JSON.stringify(item.name)}, ${item.ident}],`)
        .join("\n");
      const policyEntries = ir.policies
        .map((item) => `    [${item.modelIdent}, ${item.ident}],`)
        .join("\n");

      const channelsImport = ir.channels
        ? `import { setPreloadedChannels } from "@bunyad/broadcasting";\n`
        : "";
      const channelsApply = ir.channels
        ? `\n  setPreloadedChannels(${ir.channels.ident});`
        : "";

      const source = `import { setPreloadedDiscovery } from "@bunyad/framework";
${channelsImport}${imports.join("\n")}
${namedImports.join("\n")}

/** Compiled app discoveries — static imports for binary builds. */
export function applyPreloadedDiscovery(): void {
  setPreloadedDiscovery({
    live: [
${liveEntries}
    ],
    mailables: [${mailableEntries}],
    viewComponents: [
${viewEntries}
    ],
    policies: [
${policyEntries}
    ],${ir.user ? `\n    user: ${ir.user.ident},` : ""}${ir.token ? `\n    token: ${ir.token.ident},` : ""}
  });${channelsApply}
}
`;

      ctx.writeModule("discovery", outFile, source);
      ctx.setManifestModule("discovery", `./${outFile}`);
      ctx.setManifestMeta("discovery", {
        live: ir.live.length,
        mailables: ir.mailables.length,
        viewComponents: ir.viewComponents.length,
        policies: ir.policies.length,
        channels: Boolean(ir.channels),
      });
    },
  };
}
