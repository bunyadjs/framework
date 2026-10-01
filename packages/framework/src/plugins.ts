import {
  createRouterPlugin,
  createServerPlugin,
  createMiddlewarePlugin,
  createProvidersPlugin,
  createDiscoveryPlugin,
  createConfigPlugin,
  type CompilerPlugin,
} from "@bunyad/compiler";

export function defaultCompilerPlugins(options: {
  routesEntry?: string;
  routesEntries?: string[];
  applicationModule: string;
  optimize?: boolean;
}): CompilerPlugin[] {
  return [
    createRouterPlugin({
      routesEntry: options.routesEntry,
      routesEntries: options.routesEntries,
      optimize: options.optimize,
    }),
    createMiddlewarePlugin(),
    createProvidersPlugin(),
    createDiscoveryPlugin(),
    createConfigPlugin(),
    createServerPlugin({ applicationModule: options.applicationModule }),
  ];
}
