/**
 * Class-based view component.
 * `render()` returns a view name; public fields are passed as view data.
 * Props from `<x-*>` are assigned onto the instance after construction.
 */
export abstract class Component {
  /** Optional slot content from `<x-name>...</x-name>`. */
  slot = "";

  abstract render(): string;

  /** Extra data merged into the view (override for computed props). */
  data(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this)) {
      out[key] = (this as Record<string, unknown>)[key];
    }
    return out;
  }
}

export type ComponentClass = new () => Component;
