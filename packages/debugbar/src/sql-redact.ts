/**
 * Bindings are a bare list of values, so key-based redaction cannot see that `?` is the
 * password column. This maps each placeholder (and inline string literal) to the column it is
 * compared with or inserted into, so secret and personal columns can be masked.
 *
 * Best-effort: it understands `col <op> ?`, `col IN (?, ?)`, `col BETWEEN ? AND ?`,
 * `UPDATE ... SET col = ?` and `INSERT ... (cols) VALUES (...)`, with `?` or `$n` placeholders.
 * Anything it cannot place is left to value-based masking and `captureBindings: false`.
 */

const MASK = "********";

type Token = {
  literal: boolean;
  start: number;
  end: number;
  /** Position in the bindings array; null for literals. */
  binding: number | null;
  column: string | null;
};

const BACKTICK = String.fromCharCode(96);
const IDENT = String.raw`(?:[A-Za-z_][\w$]*|"[^"]+"|${BACKTICK}[^${BACKTICK}]+${BACKTICK}|\[[^\]]+\])`;
const VALUE = String.raw`(?:\?|\$\d+|'(?:[^'\\]|\\.|'')*')`;
const COMPARE = new RegExp(
  String.raw`(${IDENT})\s*(?:=|!=|<>|<=|>=|<|>|(?:not\s+)?i?like|(?:not\s+)?in\s*\(|(?:not\s+)?between)\s*(?:${VALUE}\s*(?:,|and)\s*)*$`,
  "i",
);
const TOKEN = /'(?:[^'\\]|\\.|'')*'|\?|\$(\d+)/g;
const INSERT = /^\s*insert\s+(?:or\s+\w+\s+)?into\s+[^\s(]+\s*\(([^)]*)\)\s*values\b/i;
const BETWEEN_TOKENS = /^\s*(?:,|and)\s*$/i;
const LOOKBEHIND = 400;

export function normalizeColumn(raw: string): string {
  return raw.trim().replace(new RegExp(`^["${BACKTICK}[]|["${BACKTICK}\\]]$`, "g"), "");
}

/** End offset of the VALUES tuples that start at `from`, and each token's item index inside its tuple. */
function insertItems(sql: string, from: number, starts: Set<number>): { end: number; itemAt: Map<number, number> } {
  const itemAt = new Map<number, number>();
  let i = from;
  let end = from;
  while (i < sql.length) {
    while (i < sql.length && /\s/.test(sql[i]!)) i++;
    if (sql[i] !== "(") break;
    let depth = 0;
    let item = 0;
    for (; i < sql.length; i++) {
      const ch = sql[i]!;
      if (ch === "'") {
        if (starts.has(i)) itemAt.set(i, item);
        const close = /'(?:[^'\\]|\\.|'')*'/y;
        close.lastIndex = i;
        const m = close.exec(sql);
        i += m ? m[0].length - 1 : 0;
        continue;
      }
      if ((ch === "?" || ch === "$") && starts.has(i)) itemAt.set(i, item);
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      } else if (ch === "," && depth === 1) item++;
    }
    end = i;
    while (i < sql.length && /\s/.test(sql[i]!)) i++;
    if (sql[i] === ",") i++;
  }
  return { end, itemAt };
}

function scan(sql: string): Token[] {
  const tokens: Token[] = [];
  let ordinal = 0;
  for (const match of sql.matchAll(TOKEN)) {
    const text = match[0];
    const literal = text.startsWith("'");
    const binding = literal ? null : text === "?" ? ordinal++ : Number(match[1]) - 1;
    tokens.push({ literal, start: match.index!, end: match.index! + text.length, binding, column: null });
  }

  const insert = INSERT.exec(sql);
  let insertEnd = -1;
  let insertStart = -1;
  let columns: string[] = [];
  let itemAt = new Map<number, number>();
  if (insert) {
    columns = insert[1]!.split(",").map(normalizeColumn);
    insertStart = insert[0].length;
    ({ end: insertEnd, itemAt } = insertItems(sql, insertStart, new Set(tokens.map((t) => t.start))));
  }

  let previous: Token | undefined;
  for (const token of tokens) {
    if (insert && token.start >= insertStart && token.start < insertEnd) {
      const item = itemAt.get(token.start);
      token.column = item === undefined ? null : (columns[item] ?? null);
    } else {
      // Items in a list (`IN (?, ?, ?)`, `BETWEEN ? AND ?`) belong to the column of the item before them.
      // Check this first: it needs no lookbehind, so a long list cannot outrun the window.
      if (previous?.column && BETWEEN_TOKENS.test(sql.slice(previous.end, token.start))) {
        token.column = previous.column;
      } else {
        const from = Math.max(0, token.start - LOOKBEHIND);
        const found = COMPARE.exec(sql.slice(from, token.start));
        // A match touching a cut-off window edge may be the tail of a longer name (`il` from `email`):
        // trusting it would pick the wrong column, so treat it as unresolved.
        if (found && !(from > 0 && found.index === 0)) token.column = normalizeColumn(found[1]!);
      }
    }
    previous = token;
  }
  return tokens;
}

/** Column each binding position belongs to, where it could be worked out. */
export function bindingColumns(sql: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const token of scan(sql)) {
    if (token.binding !== null && token.column && !out.has(token.binding)) out.set(token.binding, token.column);
  }
  return out;
}

/** Mask bindings that belong to a sensitive column. Other values pass through unchanged. */
export function redactBindings(sql: string, bindings: unknown[], sensitive: (column: string) => boolean): unknown[] {
  const columns = bindingColumns(sql);
  return bindings.map((value, index) => {
    const column = columns.get(index);
    return column !== undefined && sensitive(column) ? MASK : value;
  });
}

/** Mask inline string literals that belong to a sensitive column (raw queries that skip bindings). */
export function redactLiterals(sql: string, sensitive: (column: string) => boolean): string {
  let out = "";
  let cursor = 0;
  for (const token of scan(sql)) {
    if (!token.literal || !token.column || !sensitive(token.column)) continue;
    out += sql.slice(cursor, token.start) + `'${MASK}'`;
    cursor = token.end;
  }
  return out + sql.slice(cursor);
}
