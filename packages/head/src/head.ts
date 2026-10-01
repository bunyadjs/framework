import { HeadBuilder } from "./builder.ts";
import {
  getHeadManager,
  type HeadCallback,
} from "./manager.ts";
import type {
  CanonicalOptions,
  OgImageOptions,
  OgOptions,
  ResolvedHead,
  TitleOptions,
} from "./types.ts";

export type HeadFacade = {
  defaults(callback: HeadCallback): HeadFacade;
  inertiaGlobals(callback: HeadCallback): HeadFacade;
  inertia(options?: { prop?: string; enabled?: boolean }): HeadFacade;
  title(value: string, options?: TitleOptions): HeadBuilder;
  description(value: string): HeadBuilder;
  canonical(url?: string | true, options?: CanonicalOptions): HeadBuilder;
  robots(value: string | string[]): HeadBuilder;
  searchableByRobots(): HeadBuilder;
  hiddenFromRobots(): HeadBuilder;
  og(options: OgOptions): HeadBuilder;
  ogImage(url: string, options?: OgImageOptions): HeadBuilder;
  viewport(value: string): HeadBuilder;
  colorScheme(value: string): HeadBuilder;
  applicationName(value: string): HeadBuilder;
  themeColor(value: string): HeadBuilder;
  icon(href: string, options?: { type?: string; sizes?: string }): HeadBuilder;
  appleTouchIcon(href: string, options?: { sizes?: string }): HeadBuilder;
  manifest(href: string): HeadBuilder;
  preconnect(href: string): HeadBuilder;
  meta(
    attributes: { name?: string; property?: string; content: string },
    key?: string,
  ): HeadBuilder;
  link(
    attributes: {
      rel: string;
      href: string;
      type?: string;
      sizes?: string;
    },
    key?: string,
  ): HeadBuilder;
  tag(html: string, key?: string): HeadBuilder;
  when(condition: unknown, callback: (head: HeadBuilder) => void): HeadBuilder;
  unless(
    condition: unknown,
    callback: (head: HeadBuilder) => void,
  ): HeadBuilder;
  toHtml(requestUrl?: string): string;
  toArray(requestUrl?: string): ResolvedHead;
  toInertia(requestUrl?: string): string[];
};

/**
 * `Head` facade — site defaults, runtime metadata, and rendering helpers.
 */
export const Head: HeadFacade = {
  defaults(callback) {
    getHeadManager().defaults(callback);
    return Head;
  },

  inertiaGlobals(callback) {
    getHeadManager().inertiaGlobals(callback);
    return Head;
  },

  inertia(options = {}) {
    getHeadManager().inertia(options);
    return Head;
  },

  title(value, options = {}) {
    return getHeadManager().runtime().title(value, options);
  },

  description(value) {
    return getHeadManager().runtime().description(value);
  },

  canonical(url = true, options = {}) {
    return getHeadManager().runtime().canonical(url, options);
  },

  robots(value) {
    return getHeadManager().runtime().robots(value);
  },

  searchableByRobots() {
    return getHeadManager().runtime().searchableByRobots();
  },

  hiddenFromRobots() {
    return getHeadManager().runtime().hiddenFromRobots();
  },

  og(options) {
    return getHeadManager().runtime().og(options);
  },

  ogImage(url, options = {}) {
    return getHeadManager().runtime().ogImage(url, options);
  },

  viewport(value) {
    return getHeadManager().runtime().viewport(value);
  },

  colorScheme(value) {
    return getHeadManager().runtime().colorScheme(value);
  },

  applicationName(value) {
    return getHeadManager().runtime().applicationName(value);
  },

  themeColor(value) {
    return getHeadManager().runtime().themeColor(value);
  },

  icon(href, options = {}) {
    return getHeadManager().runtime().icon(href, options);
  },

  appleTouchIcon(href, options = {}) {
    return getHeadManager().runtime().appleTouchIcon(href, options);
  },

  manifest(href) {
    return getHeadManager().runtime().manifest(href);
  },

  preconnect(href) {
    return getHeadManager().runtime().preconnect(href);
  },

  meta(attributes, key) {
    return getHeadManager().runtime().meta(attributes, key);
  },

  link(attributes, key) {
    return getHeadManager().runtime().link(attributes, key);
  },

  tag(html, key) {
    return getHeadManager().runtime().tag(html, key);
  },

  when(condition, callback) {
    return getHeadManager().runtime().when(condition, callback);
  },

  unless(condition, callback) {
    return getHeadManager().runtime().unless(condition, callback);
  },

  toHtml(requestUrl) {
    return getHeadManager().toHtml(requestUrl);
  },

  toArray(requestUrl) {
    return getHeadManager().toArray(requestUrl);
  },

  toInertia(requestUrl) {
    return getHeadManager().toInertia(requestUrl);
  },
};
