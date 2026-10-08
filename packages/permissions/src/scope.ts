/** The global scope: grants and roles that apply everywhere. */
export const GLOBAL_SCOPE = "*";

export const scopeOf = (type: string, id: string | number): string => `${type}:${id}`;

export const scopeType = (scope: string): string => {
  const at = scope.indexOf(":");
  return at === -1 ? scope : scope.slice(0, at);
};

export const scopeId = (scope: string): string => {
  const at = scope.indexOf(":");
  return at === -1 ? "" : scope.slice(at + 1);
};

/** Parent scope of `team:42`, e.g. `tenant:7`; `null` for none (the global scope is implicit). */
export type ScopeParentResolver = (id: string, scope: string) => string | null | Promise<string | null>;

const MAX_DEPTH = 8;

export class ScopeTree {
  #parents = new Map<string, ScopeParentResolver>();

  /** Register how scopes of one type find their parent: `parent('team', (id) => 'tenant:' + ...)`. */
  parent(type: string, resolver: ScopeParentResolver): this {
    this.#parents.set(type, resolver);
    return this;
  }

  /** Root to leaf: `['*', 'tenant:7', 'team:42']`. */
  async chain(scope: string): Promise<string[]> {
    if (scope === GLOBAL_SCOPE) return [GLOBAL_SCOPE];
    const chain = [scope];
    let current = scope;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const resolver = this.#parents.get(scopeType(current));
      if (!resolver) break;
      const parent = await resolver(scopeId(current), current);
      if (!parent || parent === GLOBAL_SCOPE || chain.includes(parent)) break;
      chain.unshift(parent);
      current = parent;
    }
    chain.unshift(GLOBAL_SCOPE);
    return chain;
  }
}
