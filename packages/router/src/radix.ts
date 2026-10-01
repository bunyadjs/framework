import type { RouteDefinition } from "./router.ts";
import { parseRouteParamSegment } from "./router.ts";

export type RadixNode = {
  children: Map<string, RadixNode>;
  paramChildren: Array<{
    name: string;
    /** Constraint source without anchors, e.g. `[0-9]+`. */
    constraint: string;
    pattern: RegExp;
    /** True when any non-empty segment matches (`[^/]+`). */
    any: boolean;
    node: RadixNode;
  }>;
  route?: RouteDefinition;
};

const EMPTY_PARAMS: Record<string, string> = Object.freeze({});

function createNode(): RadixNode {
  return { children: new Map(), paramChildren: [] };
}

function normalizeUri(uri: string): string {
  if (uri === "" || uri === "/") return "/";
  const withSlash = uri.startsWith("/") ? uri : `/${uri}`;
  return withSlash.length > 1 && withSlash.endsWith("/")
    ? withSlash.slice(0, -1)
    : withSlash;
}

function segmentsOf(uri: string): string[] {
  const normalized = normalizeUri(uri);
  if (normalized === "/") return [];
  return normalized.slice(1).split("/");
}

function insertRoute(
  root: RadixNode,
  route: RouteDefinition,
  patterns: ReadonlyMap<string, string>,
): void {
  let node = root;
  const segments = segmentsOf(route.uri);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (segment.startsWith("{") && segment.endsWith("}")) {
      const { name, optional } = parseRouteParamSegment(segment.slice(1, -1));
      if (optional) {
        // Trailing optional: path may end here without the parameter.
        node.route = route;
      }
      const constraint =
        route.wheres[name] ?? patterns.get(name) ?? "[^/]+";
      let edge = node.paramChildren.find(
        (p) => p.name === name && p.constraint === constraint,
      );
      if (!edge) {
        edge = {
          name,
          constraint,
          pattern: new RegExp(`^(?:${constraint})$`),
          any: constraint === "[^/]+",
          node: createNode(),
        };
        node.paramChildren.push(edge);
      }
      node = edge.node;
    } else {
      let child = node.children.get(segment);
      if (!child) {
        child = createNode();
        node.children.set(segment, child);
      }
      node = child;
    }
  }
  node.route = route;
}

/**
 * Build a per-method radix forest from route definitions.
 */
export function buildRadixTrees(
  routes: RouteDefinition[],
  patterns: ReadonlyMap<string, string> = new Map(),
  skip?: RouteDefinition,
): Map<string, RadixNode> {
  const trees = new Map<string, RadixNode>();
  for (const route of routes) {
    if (skip && route === skip) continue;
    if (route.domain) continue;
    for (const method of route.methods) {
      let root = trees.get(method);
      if (!root) {
        root = createNode();
        trees.set(method, root);
      }
      insertRoute(root, route, patterns);
    }
  }
  return trees;
}

/**
 * Walk a method radix tree for `path` (already normalized).
 */
export function matchRadix(
  root: RadixNode,
  path: string,
): { route: RouteDefinition; params: Record<string, string> } | undefined {
  const parts: string[] = [];
  if (path !== "/" && path !== "") {
    let start = path.charCodeAt(0) === 47 ? 1 : 0;
    const len = path.length;
    while (start < len) {
      let end = start;
      while (end < len && path.charCodeAt(end) !== 47) end++;
      parts.push(path.slice(start, end));
      start = end + 1;
    }
  }

  const params: Record<string, string> = {};
  let paramCount = 0;

  const walk = (node: RadixNode, index: number): RouteDefinition | undefined => {
    if (index === parts.length) return node.route;

    const segment = parts[index]!;
    const staticChild = node.children.get(segment);
    if (staticChild) {
      const hit = walk(staticChild, index + 1);
      if (hit) return hit;
    }

    const edges = node.paramChildren;
    for (let e = 0; e < edges.length; e++) {
      const edge = edges[e]!;
      if (!edge.any && !edge.pattern.test(segment)) continue;
      params[edge.name] = segment;
      paramCount++;
      const hit = walk(edge.node, index + 1);
      if (hit) return hit;
      delete params[edge.name];
      paramCount--;
    }

    return undefined;
  };

  const route = walk(root, 0);
  if (!route) return undefined;
  return {
    route,
    params: paramCount > 0 ? params : EMPTY_PARAMS,
  };
}
