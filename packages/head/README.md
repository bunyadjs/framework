# @bunyad/head

A per-request builder for the HTML head: title with inherited suffix, description, canonical URL, Open Graph tags and robots, rendered to HTML or shared with Inertia.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/head@beta
# or: npm install @bunyad/head@beta
```

## Usage

```ts
import { Head, runWithHead } from "@bunyad/head";

// Once at boot: defaults inherited by every request
Head.defaults((head) => {
  head.title("Bunyad", { suffix: " - Bunyad" }).description("Build apps.").canonical();
});

// Per request (normally via the handleHead() middleware)
runWithHead(
  () => {
    Head.title("About").og({ type: "article", siteName: "Bunyad" });
    Head.toArray().title; // "About - Bunyad"
    Head.toHtml();
    // <title data-inertia="title">About - Bunyad</title>
    // <meta data-inertia="description" name="description" content="Build apps.">
    // <link data-inertia="canonical" rel="canonical" href="https://example.com/about">
    // <meta data-inertia="og:type" property="og:type" content="article">
    // ...
  },
  { url: "http://example.com/about" },
);
```

Other builders: `ogImage(url, { width, height, alt })`, `searchableByRobots()`, and `title(text, { exact: true })` to ignore the inherited suffix.

## Notes

- Bun only (Bun 1.4 or newer).
- In an app, add `handleHead()` early in the global middleware stack so each request gets its own head state; `shareHeadWithInertia(share)` exposes it as an Inertia shared prop.
- `canonical()` and `og:url` are emitted as `https` URLs even when the request URL is `http`.
- Depends on `@bunyad/http` and `@bunyad/contracts`.

## License

MIT
