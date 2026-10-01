export type TitleOptions = {
  /** Appended when a higher layer sets a title (e.g. `" - Bunyad"`). */
  suffix?: string;
  /** Prepended when a higher layer sets a title. */
  prefix?: string;
  /** Ignore inherited prefix/suffix. */
  exact?: boolean;
};

export type CanonicalOptions = {
  forceHttps?: boolean;
};

export type OgOptions = {
  type?: string;
  title?: string;
  description?: string;
  siteName?: string;
  url?: string;
  locale?: string;
};

export type OgImageOptions = {
  alt?: string;
  width?: number;
  height?: number;
  type?: string;
};

export type HeadElement = {
  /** Stable Inertia ownership key (`data-inertia`). */
  key: string;
  html: string;
};

export type ResolvedHead = {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: string;
  og: Record<string, string>;
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
};
