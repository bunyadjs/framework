import type { Engine, SearchableModel, SearchDocument } from "./types.ts";
import { scoutKey, searchableIndex, toSearchDocument } from "./search.ts";

export type AlgoliaEngineOptions = {
  /** Application ID (`ALGOLIA_APP_ID`). */
  id?: string;
  /** Admin / write API key (`ALGOLIA_SECRET`). */
  secret?: string;
  /** Inject fetch (tests). */
  fetch?: typeof fetch;
};

/**
 * Algolia Search engine — HTTP Search API (injectable fetch for tests).
 */
export class AlgoliaEngine implements Engine {
  readonly #appId: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: AlgoliaEngineOptions = {}) {
    this.#appId =
      options.id ??
      process.env.ALGOLIA_APP_ID ??
      process.env.SEARCH_ALGOLIA_ID ?? process.env.SCOUT_ALGOLIA_ID ??
      "";
    this.#apiKey =
      options.secret ??
      process.env.ALGOLIA_SECRET ??
      process.env.SEARCH_ALGOLIA_SECRET ?? process.env.SCOUT_ALGOLIA_SECRET ??
      "";
    this.#fetch = options.fetch ?? fetch;
    if (!this.#appId || !this.#apiKey) {
      throw new Error(
        "Algolia engine requires id/secret (ALGOLIA_APP_ID / ALGOLIA_SECRET).",
      );
    }
  }

  #headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-Algolia-Application-Id": this.#appId,
      "X-Algolia-API-Key": this.#apiKey,
    };
  }

  #writeUrl(path: string): string {
    return `https://${this.#appId}.algolia.net/1/indexes${path}`;
  }

  #readUrl(path: string): string {
    return `https://${this.#appId}-dsn.algolia.net/1/indexes${path}`;
  }

  async update(models: SearchableModel[]): Promise<void> {
    const byIndex = groupByIndex(models);
    for (const [index, group] of byIndex) {
      const requests = group.map((model) => ({
        action: "updateObject",
        body: {
          ...toSearchDocument(model),
          objectID: scoutKey(model),
        },
      }));
      const res = await this.#fetch(this.#writeUrl(`/${index}/batch`), {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({ requests }),
      });
      if (!res.ok) {
        throw new Error(`Algolia update failed (${res.status}).`);
      }
    }
  }

  async delete(models: SearchableModel[]): Promise<void> {
    const byIndex = groupByIndex(models);
    for (const [index, group] of byIndex) {
      const requests = group.map((model) => ({
        action: "deleteObject",
        body: { objectID: scoutKey(model) },
      }));
      const res = await this.#fetch(this.#writeUrl(`/${index}/batch`), {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({ requests }),
      });
      if (!res.ok) {
        throw new Error(`Algolia delete failed (${res.status}).`);
      }
    }
  }

  async search(builder: {
    index: string;
    query: string;
    wheres: Record<string, unknown>;
    whereIns: Record<string, unknown[]>;
    limit: number | null;
  }): Promise<{ ids: string[]; hits: SearchDocument[] }> {
    const whereParts = Object.entries(builder.wheres).map(
      ([k, v]) => `${k}:${JSON.stringify(v)}`,
    );
    const whereInParts = Object.entries(builder.whereIns ?? {}).map(
      ([k, values]) =>
        `(${values.map((v) => `${k}:${JSON.stringify(v)}`).join(" OR ")})`,
    );
    const filters = [...whereParts, ...whereInParts].join(" AND ");
    const body: Record<string, unknown> = {
      query: builder.query,
      hitsPerPage: builder.limit ?? 20,
    };
    if (filters) body.filters = filters;

    const res = await this.#fetch(this.#readUrl(`/${builder.index}/query`), {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Algolia search failed (${res.status}).`);
    }
    const json = (await res.json()) as {
      hits?: Array<SearchDocument & { objectID?: string }>;
    };
    const hits = (json.hits ?? []).map((h) => ({
      ...h,
      __scout_key: String(h.objectID ?? h.__scout_key ?? ""),
    }));
    return {
      ids: hits.map((h) => String(h.__scout_key)),
      hits,
    };
  }

  async flush(index: string): Promise<void> {
    const res = await this.#fetch(this.#writeUrl(`/${index}/clear`), {
      method: "POST",
      headers: this.#headers(),
    });
    if (!res.ok) {
      throw new Error(`Algolia flush failed (${res.status}).`);
    }
  }
}

function groupByIndex(
  models: SearchableModel[],
): Map<string, SearchableModel[]> {
  const map = new Map<string, SearchableModel[]>();
  for (const model of models) {
    const index = searchableIndex(model);
    const list = map.get(index) ?? [];
    list.push(model);
    map.set(index, list);
  }
  return map;
}
