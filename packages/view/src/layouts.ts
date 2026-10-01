/**
 * Resolve @extends / @section / @yield into a single template source.
 */
export function resolveLayouts(
  source: string,
  load: (name: string) => string,
): string {
  const extendsMatch = source.match(/@extends\(\s*['"]([^'"]+)['"]\s*\)/);
  // A layout rendered on its own (e.g. with a `slot`) still has its `@yield`s
  // filled: with the default, or nothing.
  if (!extendsMatch) return fillYields(source, {});

  return fillYields(load(extendsMatch[1]!), extractSections(source));
}

function fillYields(layout: string, sections: Record<string, string>): string {
  return layout.replace(
    /@yield\(\s*['"]([^'"]+)['"]\s*(?:,\s*((?:'(?:\\'|[^'])*'|"(?:\\"|[^"])*"|[^)]+)))?\s*\)/g,
    (_, name: string, rawDefault?: string) => {
      if (sections[name] != null) return sections[name]!;
      if (rawDefault == null) return "";
      return unquoteYieldDefault(rawDefault.trim());
    },
  );
}

/** Strip surrounding quotes from a yield default literal, or return the raw expression text. */
function unquoteYieldDefault(raw: string): string {
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    return raw.slice(1, -1).replace(/\\(['"])/g, "$1");
  }
  return raw;
}

function extractSections(source: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const withoutExtends = source.replace(/@extends\(\s*['"][^'"]+['"]\s*\)\s*/, "");
  const re = /@section\(\s*['"]([^'"]+)['"]\s*\)([\s\S]*?)@endsection/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutExtends)) !== null) {
    sections[match[1]!] = match[2]!.trim();
  }
  return sections;
}
