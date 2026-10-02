import type {
  CanonicalOptions,
  HeadElement,
  OgImageOptions,
  OgOptions,
  ResolvedHead,
  TitleOptions,
} from "./types.ts";

type Layer = Partial<{
  title: string;
  titleOptions: TitleOptions;
  description: string;
  canonical: string | true;
  canonicalOptions: CanonicalOptions;
  robots: string;
  og: OgOptions;
  images: Array<{ url: string } & OgImageOptions>;
  meta: Array<{ name?: string; property?: string; content: string; key: string }>;
  links: Array<{
    rel: string;
    href: string;
    type?: string;
    sizes?: string;
    key: string;
  }>;
  customs: Array<{ key: string; html: string }>;
  viewport: string;
  colorScheme: string;
  applicationName: string;
  themeColor: string;
  icon: { href: string; type?: string; sizes?: string };
  appleTouchIcon: { href: string; sizes?: string };
  manifest: string;
}>;

function escapeAttr(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Fluent document `<head>` metadata builder.
 */
export class HeadBuilder {
  #layer: Layer = { images: [], meta: [], links: [], customs: [], og: {} };

  title(value: string, options: TitleOptions = {}): this {
    this.#layer.title = value;
    this.#layer.titleOptions = options;
    return this;
  }

  description(value: string): this {
    this.#layer.description = value;
    return this;
  }

  canonical(url: string | true = true, options: CanonicalOptions = {}): this {
    this.#layer.canonical = url;
    this.#layer.canonicalOptions = options;
    return this;
  }

  robots(value: string | string[]): this {
    this.#layer.robots = Array.isArray(value) ? value.join(", ") : value;
    return this;
  }

  searchableByRobots(): this {
    return this.robots("all");
  }

  hiddenFromRobots(): this {
    return this.robots("none");
  }

  og(options: OgOptions): this {
    this.#layer.og = { ...this.#layer.og, ...options };
    return this;
  }

  ogImage(url: string, options: OgImageOptions = {}): this {
    const images = this.#layer.images ?? [];
    const existing = images.findIndex((img) => img.url === url);
    const entry = { url, ...options };
    if (existing >= 0) images[existing] = entry;
    else images.push(entry);
    this.#layer.images = images;
    return this;
  }

  viewport(value: string): this {
    this.#layer.viewport = value;
    return this;
  }

  colorScheme(value: string): this {
    this.#layer.colorScheme = value;
    return this;
  }

  applicationName(value: string): this {
    this.#layer.applicationName = value;
    return this;
  }

  themeColor(value: string): this {
    this.#layer.themeColor = value;
    return this;
  }

  icon(href: string, options: { type?: string; sizes?: string } = {}): this {
    this.#layer.icon = { href, ...options };
    return this;
  }

  appleTouchIcon(href: string, options: { sizes?: string } = {}): this {
    this.#layer.appleTouchIcon = { href, ...options };
    return this;
  }

  manifest(href: string): this {
    this.#layer.manifest = href;
    return this;
  }

  preconnect(href: string): this {
    return this.link({ rel: "preconnect", href }, `preconnect:${href}`);
  }

  dnsPrefetch(href: string): this {
    return this.link({ rel: "dns-prefetch", href }, `dns-prefetch:${href}`);
  }

  prefetch(href: string): this {
    return this.link({ rel: "prefetch", href }, `prefetch:${href}`);
  }

  preload(
    href: string,
    options: { as?: string; type?: string } = {},
  ): this {
    const key = `preload:${href}`;
    const asAttr = options.as ? ` as="${escapeAttr(options.as)}"` : "";
    const typeAttr = options.type ? ` type="${escapeAttr(options.type)}"` : "";
    return this.tag(
      `<link rel="preload" href="${escapeAttr(href)}"${asAttr}${typeAttr}>`,
      key,
    );
  }

  meta(
    attributes: { name?: string; property?: string; content: string },
    key?: string,
  ): this {
    const meta = this.#layer.meta ?? [];
    const resolvedKey =
      key ??
      attributes.name ??
      attributes.property ??
      `meta-${meta.length}`;
    const idx = meta.findIndex((m) => m.key === resolvedKey);
    const entry = { ...attributes, key: resolvedKey };
    if (idx >= 0) meta[idx] = entry;
    else meta.push(entry);
    this.#layer.meta = meta;
    return this;
  }

  link(
    attributes: {
      rel: string;
      href: string;
      type?: string;
      sizes?: string;
    },
    key?: string,
  ): this {
    const links = this.#layer.links ?? [];
    const resolvedKey = key ?? `${attributes.rel}:${attributes.href}`;
    const idx = links.findIndex((l) => l.key === resolvedKey);
    const entry = { ...attributes, key: resolvedKey };
    if (idx >= 0) links[idx] = entry;
    else links.push(entry);
    this.#layer.links = links;
    return this;
  }

  /** Raw HTML tag (must already be escaped if needed). */
  tag(html: string, key?: string): this {
    const customs = this.#layer.customs ?? [];
    const resolvedKey = key ?? `custom-${customs.length}`;
    const idx = customs.findIndex((c) => c.key === resolvedKey);
    const entry = { key: resolvedKey, html };
    if (idx >= 0) customs[idx] = entry;
    else customs.push(entry);
    this.#layer.customs = customs;
    return this;
  }

  when(condition: unknown, callback: (head: this) => void): this {
    if (condition) callback(this);
    return this;
  }

  unless(condition: unknown, callback: (head: this) => void): this {
    if (!condition) callback(this);
    return this;
  }

  /** @internal */
  layer(): Layer {
    return this.#layer;
  }

  /** @internal */
  static merge(layers: Layer[], requestUrl?: string): ResolvedHead {
    const out: ResolvedHead = {
      og: {},
      images: [],
      meta: [],
      links: [],
      customs: [],
    };

    let titleBase: string | undefined;
    let titleOptions: TitleOptions = {};
    let defaultSuffix: string | undefined;
    let defaultPrefix: string | undefined;

    for (const layer of layers) {
      if (layer.titleOptions?.suffix != null) {
        defaultSuffix = layer.titleOptions.suffix;
      }
      if (layer.titleOptions?.prefix != null) {
        defaultPrefix = layer.titleOptions.prefix;
      }
      if (layer.title != null) {
        titleBase = layer.title;
        titleOptions = layer.titleOptions ?? {};
      }
      if (layer.description != null) out.description = layer.description;
      if (layer.canonical != null) {
        out.canonical = resolveCanonical(
          layer.canonical,
          layer.canonicalOptions,
          requestUrl,
        );
      }
      if (layer.robots != null) out.robots = layer.robots;
      if (layer.og) out.og = { ...out.og, ...stringifyOg(layer.og) };
      if (layer.images?.length) out.images = [...layer.images];
      if (layer.meta?.length) {
        for (const m of layer.meta) {
          const idx = out.meta.findIndex((x) => x.key === m.key);
          if (idx >= 0) out.meta[idx] = m;
          else out.meta.push(m);
        }
      }
      if (layer.links?.length) {
        for (const l of layer.links) {
          const idx = out.links.findIndex((x) => x.key === l.key);
          if (idx >= 0) out.links[idx] = l;
          else out.links.push(l);
        }
      }
      if (layer.customs?.length) {
        for (const c of layer.customs) {
          const idx = out.customs.findIndex((x) => x.key === c.key);
          if (idx >= 0) out.customs[idx] = c;
          else out.customs.push(c);
        }
      }
      if (layer.viewport != null) {
        upsertMeta(out, "viewport", { name: "viewport", content: layer.viewport });
      }
      if (layer.colorScheme != null) {
        upsertMeta(out, "color-scheme", {
          name: "color-scheme",
          content: layer.colorScheme,
        });
      }
      if (layer.applicationName != null) {
        upsertMeta(out, "application-name", {
          name: "application-name",
          content: layer.applicationName,
        });
      }
      if (layer.themeColor != null) {
        upsertMeta(out, "theme-color", {
          name: "theme-color",
          content: layer.themeColor,
        });
      }
      if (layer.icon) {
        upsertLink(out, "icon", {
          rel: "icon",
          href: layer.icon.href,
          type: layer.icon.type,
          sizes: layer.icon.sizes,
        });
      }
      if (layer.appleTouchIcon) {
        upsertLink(out, "apple-touch-icon", {
          rel: "apple-touch-icon",
          href: layer.appleTouchIcon.href,
          sizes: layer.appleTouchIcon.sizes,
        });
      }
      if (layer.manifest) {
        upsertLink(out, "manifest", { rel: "manifest", href: layer.manifest });
      }
    }

    if (titleBase != null) {
      if (titleOptions.exact) {
        out.title = titleBase;
      } else {
        const prefix = titleOptions.prefix ?? defaultPrefix ?? "";
        const suffix = titleOptions.suffix ?? defaultSuffix ?? "";
        out.title = `${prefix}${titleBase}${suffix}`;
      }
    }

    if (out.description != null && out.og["og:description"] == null) {
      out.og["og:description"] = out.description;
    }
    if (out.title != null && out.og["og:title"] == null) {
      out.og["og:title"] = out.title;
    }
    if (out.canonical != null && out.og["og:url"] == null) {
      out.og["og:url"] = out.canonical;
    }

    return out;
  }

  /** @internal */
  static toElements(
    resolved: ResolvedHead,
    options: { inertiaOwned?: boolean } = {},
  ): HeadElement[] {
    const owned = options.inertiaOwned !== false;
    const elements: HeadElement[] = [];

    const attr = (key: string) =>
      owned ? ` data-inertia="${escapeAttr(key)}"` : "";

    if (resolved.title != null) {
      elements.push({
        key: "title",
        html: `<title${attr("title")}>${escapeText(resolved.title)}</title>`,
      });
    }
    if (resolved.description != null) {
      elements.push({
        key: "description",
        html: `<meta${attr("description")} name="description" content="${escapeAttr(resolved.description)}">`,
      });
    }
    if (resolved.canonical != null) {
      elements.push({
        key: "canonical",
        html: `<link${attr("canonical")} rel="canonical" href="${escapeAttr(resolved.canonical)}">`,
      });
    }
    if (resolved.robots != null) {
      elements.push({
        key: "robots",
        html: `<meta${attr("robots")} name="robots" content="${escapeAttr(resolved.robots)}">`,
      });
    }

    for (const [property, content] of Object.entries(resolved.og)) {
      const key = property;
      elements.push({
        key,
        html: `<meta${attr(key)} property="${escapeAttr(property)}" content="${escapeAttr(content)}">`,
      });
    }

    for (const [i, image] of resolved.images.entries()) {
      const key = `og:image:${i}`;
      elements.push({
        key,
        html: `<meta${attr(key)} property="og:image" content="${escapeAttr(image.url)}">`,
      });
      if (image.width != null) {
        elements.push({
          key: `${key}:width`,
          html: `<meta${attr(`${key}:width`)} property="og:image:width" content="${escapeAttr(image.width)}">`,
        });
      }
      if (image.height != null) {
        elements.push({
          key: `${key}:height`,
          html: `<meta${attr(`${key}:height`)} property="og:image:height" content="${escapeAttr(image.height)}">`,
        });
      }
      if (image.alt != null) {
        elements.push({
          key: `${key}:alt`,
          html: `<meta${attr(`${key}:alt`)} property="og:image:alt" content="${escapeAttr(image.alt)}">`,
        });
      }
      if (image.type != null) {
        elements.push({
          key: `${key}:type`,
          html: `<meta${attr(`${key}:type`)} property="og:image:type" content="${escapeAttr(image.type)}">`,
        });
      }
    }

    for (const m of resolved.meta) {
      const nameAttr = m.name ? ` name="${escapeAttr(m.name)}"` : "";
      const propAttr = m.property
        ? ` property="${escapeAttr(m.property)}"`
        : "";
      elements.push({
        key: m.key,
        html: `<meta${attr(m.key)}${nameAttr}${propAttr} content="${escapeAttr(m.content)}">`,
      });
    }

    for (const l of resolved.links) {
      const typeAttr = l.type ? ` type="${escapeAttr(l.type)}"` : "";
      const sizesAttr = l.sizes ? ` sizes="${escapeAttr(l.sizes)}"` : "";
      elements.push({
        key: l.key,
        html: `<link${attr(l.key)} rel="${escapeAttr(l.rel)}" href="${escapeAttr(l.href)}"${typeAttr}${sizesAttr}>`,
      });
    }

    for (const c of resolved.customs) {
      elements.push({ key: c.key, html: c.html });
    }

    return elements;
  }
}

function stringifyOg(og: OgOptions): Record<string, string> {
  const out: Record<string, string> = {};
  if (og.type != null) out["og:type"] = og.type;
  if (og.title != null) out["og:title"] = og.title;
  if (og.description != null) out["og:description"] = og.description;
  if (og.siteName != null) out["og:site_name"] = og.siteName;
  if (og.url != null) out["og:url"] = og.url;
  if (og.locale != null) out["og:locale"] = og.locale;
  return out;
}

function resolveCanonical(
  value: string | true,
  options: CanonicalOptions | undefined,
  requestUrl?: string,
): string {
  const forceHttps = options?.forceHttps !== false;
  let url =
    value === true
      ? (requestUrl ?? "/")
      : /^https?:\/\//i.test(value)
        ? value
        : requestUrl
          ? new URL(value, requestUrl).toString()
          : value;
  if (forceHttps && url.startsWith("http://")) {
    url = `https://${url.slice("http://".length)}`;
  }
  return url;
}

function upsertMeta(
  out: ResolvedHead,
  key: string,
  attributes: { name?: string; property?: string; content: string },
): void {
  const idx = out.meta.findIndex((m) => m.key === key);
  const entry = { ...attributes, key };
  if (idx >= 0) out.meta[idx] = entry;
  else out.meta.push(entry);
}

function upsertLink(
  out: ResolvedHead,
  key: string,
  attributes: {
    rel: string;
    href: string;
    type?: string;
    sizes?: string;
  },
): void {
  const idx = out.links.findIndex((l) => l.key === key);
  const entry = { ...attributes, key };
  if (idx >= 0) out.links[idx] = entry;
  else out.links.push(entry);
}
