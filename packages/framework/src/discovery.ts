import { existsSync } from "node:fs";
import { basename, relative } from "node:path";
import type { Application } from "@bunyad/core";
import {
  Gate,
  SessionGuard,
  setAuthGuard,
  setTokenGuard,
  userProviderModel,
  type AuthConfig,
  type PolicyClass,
} from "@bunyad/auth";
import { Live, type LiveComponentClass } from "@bunyad/live";
import { registerMailable, type MailableConstructor } from "@bunyad/mail";
import type { Model } from "@bunyad/orm";
import { getViewFactory, type ComponentClass } from "@bunyad/view";
import { tokenGuardUsing } from "./token-guard-using.ts";

type ModelClass = typeof Model;
type PolicyModelClass = abstract new (...args: never[]) => object;

export type PreloadedDiscovery = {
  live?: Array<[string, LiveComponentClass]>;
  mailables?: MailableConstructor[];
  viewComponents?: Array<[string, ComponentClass]>;
  policies?: Array<[PolicyModelClass, PolicyClass]>;
  user?: ModelClass;
  token?: ModelClass;
};

let preloaded: PreloadedDiscovery | undefined;

/** Register compile-time discoveries before `createApplication()`. */
export function setPreloadedDiscovery(value: PreloadedDiscovery): void {
  preloaded = value;
}

export function getPreloadedDiscovery(): PreloadedDiscovery | undefined {
  return preloaded;
}

export function pascalToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function dottedKebabName(file: string, root: string): string {
  const rel = relative(root, file).replace(/\.(ts|tsx|js|jsx)$/, "");
  return rel
    .split(/[\\/]/)
    .filter((part) => part && part !== ".")
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
  return files;
}

async function importDefault(file: string): Promise<unknown> {
  const mod = await import(file);
  return mod.default;
}

function isClass(value: unknown): value is new (...args: never[]) => object {
  return typeof value === "function";
}

/**
 * Register Live components from `app/Live` (or a compiled preload).
 * Runs once at boot — `Bun.Glob` + parallel imports, then a Map write.
 */
export async function discoverLive(app: Application): Promise<void> {
  const cached = preloaded?.live;
  if (cached) {
    for (const [name, Ctor] of cached) Live.component(name, Ctor);
    return;
  }

  const root = app.path("Live");
  const files = await listFiles(root, "**/*.{ts,tsx}");
  if (files.length === 0) return;

  const modules = await Promise.all(
    files.map(async (file) => ({
      name: dottedKebabName(file, root),
      exported: await importDefault(file),
    })),
  );

  for (const { name, exported } of modules) {
    if (isClass(exported)) {
      Live.component(name, exported as LiveComponentClass);
    }
  }
}

/** Register mailables from `app/Mail` so queued jobs can revive them by name. */
export async function discoverMailables(app: Application): Promise<void> {
  const cached = preloaded?.mailables;
  if (cached) {
    for (const Ctor of cached) registerMailable(Ctor);
    return;
  }

  const root = app.path("Mail");
  const files = await listFiles(root, "**/*.{ts,tsx}");
  if (files.length === 0) return;

  const exported = await Promise.all(files.map(importDefault));
  for (const value of exported) {
    if (isClass(value)) {
      registerMailable(value as MailableConstructor);
    }
  }
}

/** Register class-based `<x-*>` view components from `app/View/Components`. */
export async function discoverViewComponents(app: Application): Promise<void> {
  const views = getViewFactory();
  if (!views) return;

  const cached = preloaded?.viewComponents;
  if (cached) {
    for (const [name, Ctor] of cached) views.component(name, Ctor);
    return;
  }

  const root = app.path("View/Components");
  const files = await listFiles(root, "**/*.{ts,tsx}");
  if (files.length === 0) return;

  const modules = await Promise.all(
    files.map(async (file) => ({
      name: dottedKebabName(file, root),
      exported: await importDefault(file),
    })),
  );

  for (const { name, exported } of modules) {
    if (isClass(exported)) {
      views.component(name, exported as ComponentClass);
    }
  }
}

/**
 * Auth by convention: the user model named by `config/auth.ts`
 * (`providers.users.model`, default `User`) + optional `PersonalAccessToken`.
 * The session guard is installed only when `session.store` is registered.
 * Override in the application provider `boot()` if you need a custom guard.
 * Returns the user model when found.
 */
export async function discoverAuth(app: Application): Promise<ModelClass | undefined> {
  const model = userProviderModel(app.config.get("auth") as AuthConfig | undefined);
  const User =
    preloaded?.user ??
    ((await importIfExists(app.path(`Models/${model}.ts`))) as ModelClass | undefined);
  if (!User) return undefined;

  if (app.bound("session.store")) {
    setAuthGuard(
      new SessionGuard({
        retrieveById: (id) => User.find(id),
        retrieveByCredentials: (email) => User.where("email", email).first(),
        updateRememberToken: async (user, token) => {
          await User.where("id", user.id).update({ remember_token: token });
        },
        updatePassword: async (user, hashed) => {
          await User.where("id", user.id).update({ password: hashed });
        },
      }),
    );
  }

  const Token =
    preloaded?.token ??
    ((await importIfExists(app.path("Models/PersonalAccessToken.ts"))) as
      | ModelClass
      | undefined);
  if (!Token) return User;

  setTokenGuard(
    tokenGuardUsing({
      Token,
      findUser: (id) => User.find(id),
      findUserByCredentials: (credentials) => {
        let query = User.query();
        for (const [column, value] of Object.entries(credentials)) {
          query = query.where(column, value as never);
        }
        return query.first();
      },
    }),
  );
  return User;
}

/** `PostPolicy` in `app/Policies` maps to `Post` in `app/Models`. */
export async function discoverPolicies(app: Application): Promise<void> {
  const cached = preloaded?.policies;
  if (cached) {
    for (const [model, policy] of cached) Gate.policy(model, policy);
    return;
  }

  const root = app.path("Policies");
  const files = await listFiles(root, "**/*.{ts,tsx}");
  if (files.length === 0) return;

  await Promise.all(
    files.map(async (file) => {
      const base = basename(file).replace(/\.(ts|tsx)$/, "");
      if (!base.endsWith("Policy") || base === "Policy") return;
      const modelName = base.slice(0, -"Policy".length);
      const modelPath = app.path(`Models/${modelName}.ts`);
      if (!existsSync(modelPath)) return;

      const [policyMod, modelMod] = await Promise.all([
        import(file),
        import(modelPath),
      ]);
      if (isClass(policyMod.default) && isClass(modelMod.default)) {
        Gate.policy(modelMod.default, policyMod.default as PolicyClass);
      }
    }),
  );
}

async function importIfExists(file: string): Promise<unknown> {
  if (!existsSync(file)) return undefined;
  return importDefault(file);
}
