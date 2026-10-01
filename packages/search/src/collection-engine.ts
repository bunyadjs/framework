import type { Engine, SearchableModel, SearchDocument } from "./types.ts";
import { scoutKey, searchableIndex, toSearchDocument } from "./search.ts";

/**
 * In-memory Search engine (Laravel `collection` driver).
 */
export class CollectionEngine implements Engine {
  #indexes = new Map<string, Map<string, SearchDocument>>();

  async update(models: SearchableModel[]): Promise<void> {
    for (const model of models) {
      const index = searchableIndex(model);
      const map = this.#indexes.get(index) ?? new Map();
      const doc = toSearchDocument(model);
      map.set(scoutKey(model), doc);
      this.#indexes.set(index, map);
    }
  }

  async delete(models: SearchableModel[]): Promise<void> {
    for (const model of models) {
      const index = searchableIndex(model);
      this.#indexes.get(index)?.delete(scoutKey(model));
    }
  }

  async search(builder: {
    index: string;
    query: string;
    wheres: Record<string, unknown>;
    whereIns: Record<string, unknown[]>;
    limit: number | null;
  }): Promise<{ ids: string[]; hits: SearchDocument[] }> {
    const map = this.#indexes.get(builder.index) ?? new Map();
    const tokens = tokenize(builder.query);
    const hits: SearchDocument[] = [];

    for (const [id, doc] of map) {
      if (!matchesWheres(doc, builder.wheres)) continue;
      if (!matchesWhereIns(doc, builder.whereIns ?? {})) continue;
      if (tokens.length > 0 && !matchesTokens(doc, tokens)) continue;
      hits.push(doc);
    }

    const limited =
      builder.limit != null ? hits.slice(0, builder.limit) : hits;
    return {
      ids: limited.map((h) => String(h.__scout_key ?? "")),
      hits: limited,
    };
  }

  async flush(index: string): Promise<void> {
    this.#indexes.delete(index);
  }

  /** Test helper — clear all indexes. */
  clear(): void {
    this.#indexes.clear();
  }
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function matchesTokens(doc: SearchDocument, tokens: string[]): boolean {
  const haystack = Object.entries(doc)
    .filter(([k]) => k !== "__scout_key")
    .map(([, v]) => String(v ?? "").toLowerCase())
    .join(" ");
  return tokens.every((t) => haystack.includes(t));
}

function matchesWheres(
  doc: SearchDocument,
  wheres: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(wheres)) {
    if (doc[key] !== value) return false;
  }
  return true;
}

function matchesWhereIns(
  doc: SearchDocument,
  whereIns: Record<string, unknown[]>,
): boolean {
  for (const [key, values] of Object.entries(whereIns)) {
    if (!values.includes(doc[key])) return false;
  }
  return true;
}
