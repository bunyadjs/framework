import { escapeHtml } from "./compiler.ts";

const RESERVED = new Set([
  "slot",
  "errors",
  "_old",
  "__stacks",
  "__once",
  "__aware",
  "old",
  "attributes",
]);

/**
 * Leftover HTML attributes after `@props` extraction.
 */
export class AttributeBag {
  #attrs: Record<string, unknown>;

  constructor(
    data: Record<string, unknown>,
    except: string[] = [],
  ) {
    this.#attrs = {};
    const skip = new Set([...RESERVED, ...except]);
    for (const [key, value] of Object.entries(data)) {
      if (skip.has(key) || typeof value === "function") continue;
      this.#attrs[key] = value;
    }
  }

  merge(extra: Record<string, unknown>): this {
    for (const [key, value] of Object.entries(extra)) {
      if (key === "class" && this.#attrs.class != null) {
        this.#attrs.class = `${this.#attrs.class} ${value}`;
      } else {
        this.#attrs[key] = value;
      }
    }
    return this;
  }

  class(value: string): this {
    return this.merge({ class: value });
  }

  get(key: string): unknown {
    return this.#attrs[key];
  }

  /** Raw HTML attribute string (use with `{!! attributes !!}` or `{{ attributes }}`). */
  toHTML(): string {
    return Object.entries(this.#attrs)
      .map(([key, value]) => {
        if (value === false || value == null) return "";
        if (value === true) return key;
        return `${key}="${escapeHtml(value)}"`;
      })
      .filter(Boolean)
      .join(" ");
  }

  toString(): string {
    return this.toHTML();
  }
}
