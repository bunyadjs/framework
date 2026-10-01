import { getViewFactory } from "@bunyad/view";
import {
  validate,
  ValidationException,
  type Rules,
} from "@bunyad/validation";
import {
  assertSnapshot,
  encodeSnapshotAttribute,
  escapeHtml,
  makeSnapshot,
  type LiveCall,
  type LiveEffects,
  type LiveEvent,
  type LiveUpdateResult,
  type Snapshot,
} from "./snapshot.ts";

const SKIP_KEYS = new Set([
  "slot",
  "constructor",
  "render",
  "view",
  "mount",
  "boot",
  "html",
  "toSnapshot",
  "data",
  "fill",
  "fillSnapshot",
  "updating",
  "updated",
  "dispatch",
  "redirect",
  "navigate",
  "validate",
  "getErrorBag",
  "addError",
  "resetErrorBag",
  "setErrorBag",
  "resetEffects",
  "takeEffects",
  "errors",
  "live",
  "child",
  "restoreChildren",
  "beginRender",
  "finishRenderChildren",
]);

type ChildEntry = {
  name: string;
  snapshot: Snapshot;
};

export type LiveEmbedOptions = {
  /** Stable key so the child keeps identity across parent re-renders. */
  key?: string;
};

/**
 * Server-driven UI component (Live, TypeScript-native API).
 *
 * Public fields are serialized state. Methods are callable actions from the client.
 * Nest children with `await this.live('name', props, { key })`.
 */
export abstract class LiveComponent {
  /** Registry name; set via `Live.component(name, Ctor)`. */
  static componentName?: string;

  /** Layout view for `Live.route()` full-page components (default `layouts.app`). */
  static layout?: string;

  /** Page title passed to the layout by `Live.route()`. */
  static title?: string;

  #events: LiveEvent[] = [];
  #redirect: string | null = null;
  #navigate: string | null = null;
  #errors: Record<string, string[]> = {};
  /** Previous render's children (from snapshot or last finish). */
  #children = new Map<string, ChildEntry>();
  /** Children collected during the current `html()` render. */
  #renderChildren = new Map<string, ChildEntry>();

  /** Optional view name when using `.view` templates instead of `html()`. */
  view?(): string;

  /** Called once when the component is first mounted (initial render). */
  mount?(...args: unknown[]): void | Promise<void>;

  /** Called before every render after state is applied. */
  boot?(): void | Promise<void>;

  /** Called before any property updates are applied. */
  updating?(property: string, value: unknown): void | Promise<void>;

  /** Called after a property update is applied. */
  updated?(property: string, value: unknown): void | Promise<void>;

  /**
   * Return HTML for this component.
   * Override `view()` to render a `.view` template instead.
   * May be async when embedding nested components.
   */
  html(): string | Promise<string> {
    const viewName = this.view?.();
    if (viewName) {
      return getViewFactory().render(viewName, {
        ...this.data(),
        errors: this.#errors,
      });
    }
    throw new Error(
      `${this.constructor.name} must implement html() or view().`,
    );
  }

  /** Public state bag (own enumerable fields). */
  data(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this)) {
      if (SKIP_KEYS.has(key)) continue;
      if (typeof (this as Record<string, unknown>)[key] === "function") continue;
      out[key] = (this as Record<string, unknown>)[key];
    }
    return out;
  }

  /**
   * Embed a nested Live component (own snapshot + `live:id`).
   * Pass `{ key }` when embedding multiple of the same name.
   */
  async live(
    name: string,
    props: Record<string, unknown> = {},
    options: LiveEmbedOptions = {},
  ): Promise<string> {
    const key = options.key ?? name;
    const prev = this.#children.get(key);
    let result: LiveUpdateResult;

    if (prev && prev.name === name) {
      result = await updateLive({
        name,
        snapshot: prev.snapshot,
        updates: props,
      });
    } else {
      result = await mountLiveResult(name, props);
    }

    this.#renderChildren.set(key, { name, snapshot: result.snapshot });
    return result.html;
  }

  /** Alias for `live()`. */
  child(
    name: string,
    props: Record<string, unknown> = {},
    options: LiveEmbedOptions = {},
  ): Promise<string> {
    return this.live(name, props, options);
  }

  /** Dispatch a browser CustomEvent after the next update. */
  dispatch(name: string, params: Record<string, unknown> = {}): this {
    this.#events.push({ name, params });
    return this;
  }

  /** Redirect the browser after the next update (full reload). */
  redirect(url: string): this {
    this.#redirect = url;
    return this;
  }

  /** Navigate via SPA `live:navigate` after the next update. */
  navigate(url: string): this {
    this.#navigate = url;
    return this;
  }

  /** Validate public state; on failure sets `errors` and throws. */
  async validate(
    rules: Rules,
    messages?: Record<string, string>,
    attributes?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    try {
      const validated = await validate(this.data(), rules, {
        messages,
        attributes,
      });
      this.#errors = {};
      return validated;
    } catch (error) {
      if (error instanceof ValidationException) {
        this.#errors = { ...error.errors };
      }
      throw error;
    }
  }

  getErrorBag(): Record<string, string[]> {
    return { ...this.#errors };
  }

  /** Show a message under `field` on the next render. */
  addError(field: string, message: string): this {
    (this.#errors[field] ??= []).push(message);
    return this;
  }

  /** Clear every error, or those for the given fields. */
  resetErrorBag(...fields: string[]): this {
    if (fields.length === 0) this.#errors = {};
    for (const field of fields) delete this.#errors[field];
    return this;
  }

  /** @internal Errors from a `ValidationException` thrown by an action. */
  setErrorBag(errors: Record<string, string[]>): void {
    this.#errors = { ...errors };
  }

  /** @internal */
  resetEffects(): void {
    this.#events = [];
    this.#redirect = null;
    this.#navigate = null;
  }

  /** @internal */
  takeEffects(): LiveEffects {
    const effects: LiveEffects = {
      events: this.#events.splice(0),
      redirect: this.#redirect,
      navigate: this.#navigate,
      errors: { ...this.#errors },
    };
    this.#redirect = null;
    this.#navigate = null;
    return effects;
  }

  /** @internal Restore nested snapshots before re-render. */
  restoreChildren(children?: Record<string, Snapshot>): void {
    this.#children.clear();
    this.#renderChildren.clear();
    if (!children) return;
    for (const [key, snapshot] of Object.entries(children)) {
      this.#children.set(key, { name: snapshot.name, snapshot });
    }
  }

  /** @internal */
  beginRender(): void {
    this.#renderChildren.clear();
  }

  /** @internal Promote this render's embeds into the durable child map. */
  finishRenderChildren(): Record<string, Snapshot> | undefined {
    this.#children = new Map(this.#renderChildren);
    this.#renderChildren.clear();
    if (this.#children.size === 0) return undefined;
    const out: Record<string, Snapshot> = {};
    for (const [key, entry] of this.#children) {
      out[key] = entry.snapshot;
    }
    return out;
  }

  /** Apply client property updates (`data-model` / `live:model`), running update hooks. */
  async fill(updates: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(updates)) {
      if (SKIP_KEYS.has(key)) continue;
      if (typeof (this as Record<string, unknown>)[key] === "function") continue;

      const self = this as Record<string, unknown>;
      if (typeof this.updating === "function") {
        await this.updating(key, value);
      }
      const namedUpdating = self[`updating${capitalize(key)}`];
      if (typeof namedUpdating === "function") {
        await (namedUpdating as (v: unknown) => unknown).call(this, value);
      }

      self[key] = value;

      if (typeof this.updated === "function") {
        await this.updated(key, value);
      }
      const namedUpdated = self[`updated${capitalize(key)}`];
      if (typeof namedUpdated === "function") {
        await (namedUpdated as (v: unknown) => unknown).call(this, value);
      }
    }
  }

  toSnapshot(
    name: string,
    id?: string,
    children?: Record<string, Snapshot>,
  ): Snapshot {
    return makeSnapshot(name, this.data(), id, children);
  }

  static fromSnapshot<T extends new () => LiveComponent>(
    this: T,
    snapshot: Snapshot,
  ): InstanceType<T> {
    assertSnapshot(snapshot);
    const instance = new this() as InstanceType<T>;
    instance.fillSnapshot(snapshot.data);
    instance.restoreChildren(snapshot.children);
    return instance;
  }

  /** @internal Restore snapshot without update hooks. */
  fillSnapshot(data: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(data)) {
      if (SKIP_KEYS.has(key)) continue;
      if (typeof (this as Record<string, unknown>)[key] === "function") continue;
      (this as Record<string, unknown>)[key] = value;
    }
  }
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function renderHtml(instance: LiveComponent): Promise<{
  html: string;
  children?: Record<string, Snapshot>;
}> {
  instance.beginRender();
  const body = await Promise.resolve(instance.html());
  const children = instance.finishRenderChildren();
  return { html: body, children };
}

export type LiveComponentClass = (new () => LiveComponent) & {
  componentName?: string;
  layout?: string;
  title?: string;
  fromSnapshot(snapshot: Snapshot): LiveComponent;
};

const registry = new Map<string, LiveComponentClass>();

export function registerLiveComponent(
  name: string,
  Ctor: LiveComponentClass,
): void {
  Ctor.componentName = name;
  registry.set(name, Ctor);
}

export function resolveLiveComponent(
  name: string,
): LiveComponentClass {
  const Ctor = registry.get(name);
  if (!Ctor) {
    throw new Error(`Live component [${name}] is not registered.`);
  }
  return Ctor;
}

export function listLiveComponents(): string[] {
  return [...registry.keys()];
}

export function clearLiveComponents(): void {
  registry.clear();
}

/** Render the outer root with snapshot + HTML for the browser. */
export function wrapLiveHtml(
  name: string,
  html: string,
  snapshot: Snapshot,
): string {
  const encoded = encodeSnapshotAttribute(snapshot);
  const wireId = escapeHtml(snapshot.id);
  return `<div live:id="${wireId}" data-live="${escapeHtml(name)}" data-snapshot="${encoded}">${html}</div>`;
}

export async function mountLiveResult(
  name: string,
  props: Record<string, unknown> = {},
): Promise<LiveUpdateResult> {
  const Ctor = resolveLiveComponent(name);
  const instance = new Ctor();
  await instance.fill(props);
  if (instance.mount) await instance.mount(props);
  if (instance.boot) await instance.boot();
  const { html: body, children } = await renderHtml(instance);
  const snapshot = instance.toSnapshot(name, undefined, children);
  return {
    html: wrapLiveHtml(name, body, snapshot),
    snapshot,
    effects: instance.takeEffects(),
  };
}

export async function mountLive(
  name: string,
  props: Record<string, unknown> = {},
): Promise<string> {
  return (await mountLiveResult(name, props)).html;
}

export async function updateLive(payload: {
  name: string;
  snapshot: Snapshot;
  calls?: LiveCall[];
  updates?: Record<string, unknown>;
  children?: Record<string, Snapshot>;
}): Promise<LiveUpdateResult> {
  const Ctor = resolveLiveComponent(payload.name);
  assertSnapshot(payload.snapshot);
  if (payload.snapshot.name !== payload.name) {
    throw new Error("Wire snapshot name mismatch.");
  }

  if (payload.children) {
    for (const child of Object.values(payload.children)) {
      assertSnapshot(child);
    }
  }

  const instance = new Ctor();
  instance.resetEffects();
  instance.fillSnapshot(payload.snapshot.data);
  instance.restoreChildren(payload.children ?? payload.snapshot.children);
  if (payload.updates) await instance.fill(payload.updates);

  try {
    for (const call of payload.calls ?? []) {
      const method = call.method;
      const fn = (instance as unknown as Record<string, unknown>)[method];
      if (typeof fn !== "function") {
        throw new Error(
          `Live method [${method}] does not exist on [${payload.name}].`,
        );
      }
      if (SKIP_KEYS.has(method) || method.startsWith("_")) {
        throw new Error(`Live method [${method}] is not callable.`);
      }
      await (fn as (...args: unknown[]) => unknown).apply(
        instance,
        call.params ?? [],
      );
    }
  } catch (error) {
    if (!(error instanceof ValidationException)) throw error;
    // Thrown by `this.validate()` or by the action itself (`withMessages`).
    instance.setErrorBag(error.errors);
  }

  if (instance.boot) await instance.boot();
  const { html: body, children } = await renderHtml(instance);
  const snapshot = instance.toSnapshot(
    payload.name,
    payload.snapshot.id,
    children,
  );
  const effects = instance.takeEffects();
  return {
    html: wrapLiveHtml(payload.name, body, snapshot),
    snapshot,
    effects,
  };
}
