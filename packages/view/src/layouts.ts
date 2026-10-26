/**
 * Resolve `@extends` into a single template source.
 *
 * A child view is rendered before its layout, as in Laravel: its `@section`s are rendered into a
 * registry that `@yield` reads wherever it is, in the layout or in a partial the layout includes, and
 * its `@push`es land in the stacks before the layout prints them. So the merged source is the child's
 * sections and pushes, then the layout.
 *
 * Anything else a child holds outside a section prints nowhere.
 */
export function resolveLayouts(
  source: string,
  load: (name: string) => string,
): string {
  const extendsMatch = source.match(/@extends\(\s*['"]([^'"]+)['"]\s*\)/);
  if (!extendsMatch) return source;

  return childDirectives(source) + load(extendsMatch[1]!);
}

const TOP_LEVEL = /@(section|push|prepend|use|import|let)\s*\(/g;

const END: Record<string, string> = {
  section: "@endsection",
  push: "@endpush",
  prepend: "@endprepend",
};

/** The parts of a child view that run: its sections and pushes, and the `@use`/`@let` they rely on. */
function childDirectives(source: string): string {
  const body = source.replace(/@extends\(\s*['"][^'"]+['"]\s*\)\s*/, "");
  let kept = "";
  let at = 0;

  while (at < body.length) {
    TOP_LEVEL.lastIndex = at;
    const match = TOP_LEVEL.exec(body);
    if (!match) break;

    const name = match[1]!;
    const open = match.index + match[0].length - 1;
    const close = matchingParen(body, open);
    if (close === -1) break;

    // `@section('title', 'Home')` has a value and no `@endsection`.
    const inline = name === "section" && /^\(\s*(['"])[^'"]+\1\s*,/.test(body.slice(open, close + 1));
    const end = END[name];

    let stop = close + 1;
    if (end && !inline) {
      const endAt = body.indexOf(end, stop);
      if (endAt === -1) break;
      stop = endAt + end.length;
    }

    kept += body.slice(match.index, stop);
    at = stop;
  }

  return kept;
}

/** Index of the `)` that closes the `(` at `open`, skipping quoted strings; -1 when unbalanced. */
function matchingParen(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = open; i < source.length; i++) {
    const char = source[i]!;
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}
