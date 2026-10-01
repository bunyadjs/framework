import type { Engine, SearchableModel, SearchDocument } from "./types.ts";
import { scoutKey, searchableIndex, toSearchDocument } from "./search.ts";

export type MeilisearchEngineOptions = {
  /** Host URL (`MEILISEARCH_HOST`), e.g. `http://127.0.0.1:7700`. */
  host?: string;
  /** API key (`MEILISEARCH_KEY`). */
  key?: string;
  /** Inject fetch (tests). */
  fetch?: typeof fetch;
};

/**
 * Meilisearch Search engine — HTTP API (injectable fetch for tests).
 */
export class MeilisearchEngine implements Engine {
  readonly #host: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;

  constructor(options: MeilisearchEngineOptions = {}) {
    this.#host = (
      options.host ??
      process.env.MEILISEARCH_HOST ??
      process.env.SEARCH_MEILISEARCH_HOST ?? process.env.SCOUT_MEILISEARCH_HOST ??
      "http://127.0.0.1:7700"
    ).replace(/\/$/, "");
    this.#key =
      options.key ??
      process.env.MEILISEARCH_KEY ??
      process.env.SEARCH_MEILISEARCH_KEY ?? process.env.SCOUT_MEILISEARCH_KEY ??
      "";
    this.#fetch = options.fetch ?? fetch;
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.#key) headers.Authorization = `Bearer ${this.#key}`;
    return headers;
  }

  #url(path: string): string {
    return `${this.#host}${path}`;
  }

  async update(models: SearchableModel[]): Promise<void> {
    const byIndex = groupByIndex(models);
    for (const [index, group] of byIndex) {
      const docs = group.map((model) => ({
        ...toSearchDocument(model),
        id: scoutKey(model),
      }));
      await this.#ensureIndex(index);
      const res = await this.#fetch(
        this.#url(`/indexes/${encodeURIComponent(index)}/documents`),
        {
          method: "POST",
          headers: this.#headers(),
          body: JSON.stringify(docs),
        },
      );
      if (!res.ok) {
        throw new Error(`Meilisearch update failed (${res.status}).`);
      }
    }
  }

  async delete(models: SearchableModel[]): Promise<void> {
    const byIndex = groupByIndex(models);
    for (const [index, group] of byIndex) {
      const ids = group.map((m) => scoutKey(m));
      const res = await this.#fetch(
        this.#url(
          `/indexes/${encodeURIComponent(index)}/documents/delete-batch`,
        ),
        {
          method: "POST",
          headers: this.#headers(),
          body: JSON.stringify(ids),
        },
      );
      if (!res.ok) {
        throw new Error(`Meilisearch delete failed (${res.status}).`);
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
    const formatEq = (k: string, v: unknown) =>
      typeof v === "string" ? `${k} = "${v}"` : `${k} = ${JSON.stringify(v)}`;
    const whereParts = Object.entries(builder.wheres).map(([k, v]) =>
      formatEq(k, v),
    );
    const whereInParts = Object.entries(builder.whereIns ?? {}).map(
      ([k, values]) => `(${values.map((v) => formatEq(k, v)).join(" OR ")})`,
    );
    const filter = [...whereParts, ...whereInParts].join(" AND ");
    const body: Record<string, unknown> = {
      q: builder.query,
      limit: builder.limit ?? 20,
    };
    if (filter) body.filter = filter;

    const res = await this.#fetch(
      this.#url(`/indexes/${encodeURIComponent(builder.index)}/search`),
      {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(`Meilisearch search failed (${res.status}).`);
    }
    const json = (await res.json()) as {
      hits?: Array<SearchDocument & { id?: string | number }>;
    };
    const hits = (json.hits ?? []).map((h) => ({
      ...h,
      __scout_key: String(h.id ?? h.__scout_key ?? ""),
    }));
    return {
      ids: hits.map((h) => String(h.__scout_key)),
      hits,
    };
  }

  async flush(index: string): Promise<void> {
    const res = await this.#fetch(
      this.#url(`/indexes/${encodeURIComponent(index)}/documents`),
      {
        method: "DELETE",
        headers: this.#headers(),
      },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Meilisearch flush failed (${res.status}).`);
    }
  }

  async #ensureIndex(index: string): Promise<void> {
    const res = await this.#fetch(this.#url("/indexes"), {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({ uid: index, primaryKey: "id" }),
    });
    // 409 = already exists
    if (!res.ok && res.status !== 409) {
      // Ignore create failures when index may already exist from prior calls
      const text = await res.text();
      if (!text.toLowerCase().includes("already")) {
        /* soft-fail: search/update will surface real errors */
      }
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
