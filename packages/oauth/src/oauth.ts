import type { Request } from "@bunyad/http";
import {
  AbstractProvider,
  type ProviderConfig,
  type ProviderFactory,
} from "./abstract-provider.ts";
import { DiscordProvider } from "./discord-provider.ts";
import { GithubProvider } from "./github-provider.ts";
import { GitlabProvider } from "./gitlab-provider.ts";
import { GoogleProvider } from "./google-provider.ts";

export type OAuthServices = {
  github?: ProviderConfig;
  google?: ProviderConfig;
  discord?: ProviderConfig;
  gitlab?: ProviderConfig;
  [name: string]: ProviderConfig | undefined;
};

const customCreators = new Map<string, ProviderFactory>();
let services: OAuthServices = {};
let fetchImpl: typeof fetch = fetch;
let currentRequest: Request | undefined;

function envConfig(name: string): ProviderConfig | undefined {
  const upper = name.toUpperCase();
  const id =
    process.env[`${upper}_CLIENT_ID`] ??
    process.env[`OAUTH_${upper}_CLIENT_ID`] ?? process.env[`SOCIALITE_${upper}_CLIENT_ID`];
  const secret =
    process.env[`${upper}_CLIENT_SECRET`] ??
    process.env[`OAUTH_${upper}_CLIENT_SECRET`] ?? process.env[`SOCIALITE_${upper}_CLIENT_SECRET`];
  const redirect =
    process.env[`${upper}_REDIRECT_URI`] ??
    process.env[`${upper}_REDIRECT`] ??
    process.env[`OAUTH_${upper}_REDIRECT`] ?? process.env[`SOCIALITE_${upper}_REDIRECT`];
  if (!id || !secret || !redirect) return undefined;
  const host =
    process.env[`${upper}_HOST`] ?? process.env[`OAUTH_${upper}_HOST`] ?? process.env[`SOCIALITE_${upper}_HOST`];
  return { clientId: id, clientSecret: secret, redirect, host };
}

function resolveConfig(name: string): ProviderConfig {
  const config = services[name] ?? envConfig(name);
  if (!config) {
    throw new Error(
      `OAuth provider [${name}] is not configured. Call OAuth.config() or set env vars.`,
    );
  }
  return config;
}

function createBuiltIn(name: string, config: ProviderConfig): AbstractProvider {
  switch (name) {
    case "github":
      return new GithubProvider(config, fetchImpl);
    case "google":
      return new GoogleProvider(config, fetchImpl);
    case "discord":
      return new DiscordProvider(config, fetchImpl);
    case "gitlab":
      return new GitlabProvider(config, fetchImpl);
    default:
      throw new Error(
        `Unsupported OAuth driver [${name}]. Use github, google, discord, gitlab, or OAuth.extend().`,
      );
  }
}

/**
 * Laravel OAuth-style facade (GitHub, Google, Discord, GitLab).
 */
export const OAuth = {
  /** Configure providers (`services.github` / … shape). */
  config(next: OAuthServices): void {
    services = { ...services, ...next };
  },

  /** Override fetch (tests). */
  setFetch(next: typeof fetch): void {
    fetchImpl = next;
  },

  /** Bind request for stateful OAuth (`user()` reads code/state). */
  setRequest(request: Request | undefined): void {
    currentRequest = request;
  },

  /** Register a custom driver. */
  extend(name: string, factory: ProviderFactory): void {
    customCreators.set(name, factory);
  },

  driver(name: string): AbstractProvider {
    const config = resolveConfig(name);
    const custom = customCreators.get(name);
    const provider = custom
      ? custom(config, fetchImpl)
      : createBuiltIn(name, config);
    if (currentRequest) provider.setRequest(currentRequest);
    return provider;
  },

  /** Test helper — clear config/creators. */
  flush(): void {
    services = {};
    customCreators.clear();
    currentRequest = undefined;
    fetchImpl = fetch;
  },
};
