import { escapeLike } from "@bunyad/common";

/**
 * Raw SQL that carries its own bound values.
 *
 * Every value written into the `sql` template becomes a placeholder and travels in `bindings`, so
 * user text and ids never become part of the statement. Every raw method of the query builder
 * (`whereRaw`, `selectRaw`, `orderByRaw`, `groupByRaw`, `havingRaw`) accepts a fragment
 * in place of a string:
 *
 * ```ts
 * query.whereRaw(sql`tenant_id = ${tenantId} AND ${sql.join(parts, " OR ")}`);
 * ```
 */
export type SqlFragment = {
  readonly sql: string;
  readonly bindings: readonly unknown[];
};

class TrustedSql {
  constructor(readonly sql: string) {}
}

function isFragment(value: unknown): value is SqlFragment {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SqlFragment).sql === "string" &&
    Array.isArray((value as SqlFragment).bindings)
  );
}

/** Whether `value` is something the `sql` tag produced (or a plain `{ sql, bindings }` object). */
export function isSqlFragment(value: unknown): value is SqlFragment {
  return isFragment(value);
}

function sqlTag(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
  let text = strings[0] ?? "";
  const bindings: unknown[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value instanceof TrustedSql) {
      text += value.sql;
    } else if (isFragment(value)) {
      text += value.sql;
      bindings.push(...value.bindings);
    } else {
      text += "?";
      bindings.push(value);
    }
    text += strings[i + 1] ?? "";
  }
  return { sql: text, bindings };
}

/**
 * Tagged template: fragments and `sql.trusted(...)` text are inlined, everything else is bound.
 * `sql.join`, `sql.list` and `sql.trusted` are the other ways to build a fragment.
 */
export const sql = Object.assign(sqlTag, {
  /**
   * Text that is part of the code: a column name, an expression built from constants.
   * Never pass user input or a database value through it.
   */
  trusted(text: string): unknown {
    return new TrustedSql(text);
  },

  /**
   * `column` contains `term`, taken literally, as a fragment to place inside a larger statement
   * (an `EXISTS` subquery, an `OR` group). Case-insensitive unless `{ caseSensitive: true }`
   * (which SQLite ignores). `column` is code, never user input. For a plain `WHERE` on a model
   * use `whereContains`.
   */
  contains(column: string, term: string, options: { caseSensitive?: boolean } = {}): SqlFragment {
    return likeFragment(column, `%${escapeLike(term, LIKE_ESCAPE)}%`, options.caseSensitive === true);
  },

  /** `column` starts with `term`, taken literally. See `sql.contains`. */
  startsWith(column: string, term: string, options: { caseSensitive?: boolean } = {}): SqlFragment {
    return likeFragment(column, `${escapeLike(term, LIKE_ESCAPE)}%`, options.caseSensitive === true);
  },

  /** `column` ends with `term`, taken literally. See `sql.contains`. */
  endsWith(column: string, term: string, options: { caseSensitive?: boolean } = {}): SqlFragment {
    return likeFragment(column, `%${escapeLike(term, LIKE_ESCAPE)}`, options.caseSensitive === true);
  },

  /** Join fragments with a trusted separator such as `" AND "` or `" OR "`. */
  join(parts: readonly SqlFragment[], separator: string): SqlFragment {
    return {
      sql: parts.map((part) => part.sql).join(separator),
      bindings: parts.flatMap((part) => [...part.bindings]),
    };
  },

  /** `?, ?, ?` for a list of values. Keep the list under the driver's variable limit. */
  list(values: readonly unknown[]): SqlFragment {
    return { sql: values.map(() => "?").join(", "), bindings: [...values] };
  },
});

/** Escape character used by the `sql.contains` family: valid in every database's `ESCAPE` clause. */
const LIKE_ESCAPE = "!";

function likeFragment(column: string, pattern: string, caseSensitive: boolean): SqlFragment {
  return caseSensitive
    ? { sql: `COALESCE(${column}, '') LIKE ? ESCAPE '${LIKE_ESCAPE}'`, bindings: [pattern] }
    : { sql: `LOWER(COALESCE(${column}, '')) LIKE LOWER(?) ESCAPE '${LIKE_ESCAPE}'`, bindings: [pattern] };
}

/**
 * What a raw method received: either `(sql, bindings)` or one fragment. Passing bindings
 * next to a fragment is a mistake and throws, because it would be unclear which ones win.
 */
export function rawParts(
  first: string | SqlFragment,
  bindings?: readonly unknown[],
): { sql: string; bindings: unknown[] } {
  if (typeof first === "string") {
    // The caller's array is kept as it is, as before; nothing here changes it.
    return { sql: first, bindings: (bindings ?? []) as unknown[] };
  }
  if (!isFragment(first)) {
    throw new TypeError("A raw SQL method takes a string or a sql`...` fragment.");
  }
  if (bindings !== undefined && bindings.length > 0) {
    throw new TypeError("Pass bindings inside the sql`...` fragment, not next to it.");
  }
  return { sql: first.sql, bindings: [...first.bindings] };
}
