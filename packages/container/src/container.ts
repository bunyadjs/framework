import "./reflect.ts";
import { BunyadError } from "@bunyad/common";

export type Abstract<T = unknown> =
  | (abstract new (...args: never[]) => T)
  | (new (...args: never[]) => T)
  | string;

export type Concrete<T = unknown> =
  | (new (...args: never[]) => T)
  | ((container: Container, parameters?: Record<string, unknown>) => T);

export type ClassType<T = unknown> = new (...args: never[]) => T;

export type Extender<T = unknown> = (
  service: T,
  container: Container,
) => T;

export type ResolvingCallback = (
  instance: unknown,
  container: Container,
) => void;

export type BeforeResolvingCallback = (
  abstract: string,
  parameters: Record<string, unknown>,
  container: Container,
) => void;

export type ReboundCallback = (
  container: Container,
  instance: unknown,
) => void;

export class BindingResolutionError extends BunyadError {
  constructor(abstractKey: string) {
    super(
      `Target class [${abstractKey}] does not exist.`,
      "BUNYAD_CONTAINER_001",
    );
    this.name = "BindingResolutionError";
  }
}

export class CircularDependencyError extends BunyadError {
  constructor(abstractKey: string) {
    super(
      `Circular dependency detected while resolving [${abstractKey}].`,
      "BUNYAD_CONTAINER_002",
    );
    this.name = "CircularDependencyError";
  }
}

type Binding = {
  concrete: Concrete;
  shared: boolean;
};

type ContextualGive =
  | { type: "concrete"; value: Concrete }
  | { type: "tagged"; tag: string };

function keyOf(abstract: unknown): string {
  if (typeof abstract === "string") return abstract;
  if (typeof abstract === "function") {
    return (abstract as Function).name || "Anonymous";
  }
  return String(abstract);
}

function isConstructor(concrete: Concrete): concrete is ClassType {
  const proto = Object.getOwnPropertyDescriptor(concrete, "prototype");
  return Boolean(proto && proto.writable === false);
}

/** True for plain functions / arrow factories, false for class constructors. */
function isFactoryFn(value: unknown): value is Function {
  if (typeof value !== "function") return false;
  return !isConstructor(value as Concrete);
}

function paramTypesOf(Class: Function): Function[] {
  const explicit = (Class as { inject?: unknown }).inject;
  if (Array.isArray(explicit)) return explicit as Function[];

  const meta = (
    Reflect as { getMetadata?(key: string, target: object): unknown }
  ).getMetadata?.("design:paramtypes", Class);
  if (!Array.isArray(meta)) return [];
  return meta.filter(
    (t): t is Function => typeof t === "function" && t !== Object,
  );
}

/** Method deps: `fn.inject` or Reflect `design:paramtypes` on the prototype method. */
function methodParamTypes(
  fn: Function,
  Class?: Function,
  method?: string,
): Function[] {
  const explicit = (fn as { inject?: unknown }).inject;
  if (Array.isArray(explicit)) return explicit as Function[];

  if (Class && method) {
    const R = Reflect as {
      getMetadata?(
        key: string,
        target: object,
        propertyKey?: string | symbol,
      ): unknown;
    };
    const meta = R.getMetadata?.("design:paramtypes", Class.prototype, method);
    if (Array.isArray(meta)) {
      return meta.filter(
        (t): t is Function => typeof t === "function" && t !== Object,
      );
    }
  }
  return [];
}

function parseBindMethod(method: string | [Abstract, string]): string {
  if (Array.isArray(method)) {
    return `${keyOf(method[0])}@${method[1]}`;
  }
  return method;
}

/**
 * Mark a class for constructor injection metadata emission.
 * Required for automatic DI when the class has typed constructor params.
 */
export function Injectable(): ClassDecorator {
  return (target) => target;
}

/**
 * Service container with bind/singleton, constructor injection,
 * contextual bindings, and tags.
 */
export class Container {
  static #instance: Container | null = null;

  readonly #bindings = new Map<string, Binding>();
  readonly #instances = new Map<string, unknown>();
  readonly #aliases = new Map<string, string>();
  readonly #tags = new Map<string, string[]>();
  /** whenKey → needsKey → give */
  readonly #contextual = new Map<string, Map<string, ContextualGive>>();
  readonly #buildStack: string[] = [];
  readonly #resolved = new Set<string>();
  readonly #extenders = new Map<string, Extender[]>();
  readonly #reboundCallbacks = new Map<string, ReboundCallback[]>();
  readonly #globalBeforeResolving: BeforeResolvingCallback[] = [];
  readonly #globalResolving: ResolvingCallback[] = [];
  readonly #globalAfterResolving: ResolvingCallback[] = [];
  readonly #beforeResolving = new Map<string, BeforeResolvingCallback[]>();
  readonly #resolving = new Map<string, ResolvingCallback[]>();
  readonly #afterResolving = new Map<string, ResolvingCallback[]>();
  readonly #methodBindings = new Map<
    string,
    (instance: unknown, container: Container) => unknown
  >();
  readonly #scopedInstances = new Set<string>();
  #parameterOverride: Record<string, unknown> = {};

  static getInstance(): Container {
    if (!Container.#instance) {
      Container.#instance = new Container();
    }
    return Container.#instance;
  }

  static setInstance(container: Container | null): Container | null {
    Container.#instance = container;
    return container;
  }

  bind<T>(abstract: Abstract<T>, concrete?: Concrete<T>): this {
    this.#register(abstract, concrete, false);
    return this;
  }

  bindIf<T>(abstract: Abstract<T>, concrete?: Concrete<T>): this {
    if (!this.bound(abstract)) {
      this.bind(abstract, concrete);
    }
    return this;
  }

  singleton<T>(abstract: Abstract<T>, concrete?: Concrete<T>): this {
    this.#register(abstract, concrete, true);
    return this;
  }

  singletonIf<T>(abstract: Abstract<T>, concrete?: Concrete<T>): this {
    if (!this.bound(abstract)) {
      this.singleton(abstract, concrete);
    }
    return this;
  }

  /** Shared binding cleared when `forgetScopedInstances()` runs. */
  scoped<T>(abstract: Abstract<T>, concrete?: Concrete<T>): this {
    this.#scopedInstances.add(this.#resolveAlias(keyOf(abstract)));
    return this.singleton(abstract, concrete);
  }

  scopedIf<T>(abstract: Abstract<T>, concrete?: Concrete<T>): this {
    if (!this.bound(abstract)) {
      this.scoped(abstract, concrete);
    }
    return this;
  }

  instance<T>(abstract: Abstract<T>, value: T): T {
    const key = keyOf(abstract);
    const wasBound = this.bound(abstract);
    this.#instances.set(key, value);
    this.#bindings.set(key, {
      concrete: () => value,
      shared: true,
    });
    this.#resolved.add(key);
    if (wasBound) {
      this.#rebound(key);
    }
    return value;
  }

  alias(alias: string, abstract: Abstract): this {
    this.#aliases.set(alias, keyOf(abstract));
    return this;
  }

  /** Tag one or more abstracts under a label. */
  tag(abstracts: Abstract[] | Abstract, tag: string): this {
    const list = Array.isArray(abstracts) ? abstracts : [abstracts];
    const keys = list.map(keyOf);
    const existing = this.#tags.get(tag) ?? [];
    this.#tags.set(tag, [...existing, ...keys]);
    return this;
  }

  /** Resolve all bindings for a tag. */
  tagged<T = unknown>(tag: string): T[] {
    const keys = this.#tags.get(tag) ?? [];
    return keys.map((key) => this.make<T>(key));
  }

  /**
   * Contextual binding: `when(Consumer).needs(Dep).give(...)`.
   */
  when(concrete: Abstract): ContextualBindingBuilder {
    return new ContextualBindingBuilder(this, keyOf(concrete));
  }

  /** Register a contextual binding (used by `when().needs().give()`). */
  addContextualBinding(
    concrete: Abstract,
    abstract: Abstract,
    implementation: Concrete | unknown,
  ): this {
    const whenKey = keyOf(concrete);
    const needsKey = this.#resolveAlias(keyOf(abstract));
    if (typeof implementation === "function") {
      this.addContextual(whenKey, needsKey, {
        type: "concrete",
        value: implementation as Concrete,
      });
    } else {
      const value = implementation;
      this.addContextual(whenKey, needsKey, {
        type: "concrete",
        value: () => value,
      });
    }
    return this;
  }

  /** Used by ContextualBindingBuilder. */
  addContextual(
    whenKey: string,
    needsKey: string,
    give: ContextualGive,
  ): void {
    let map = this.#contextual.get(whenKey);
    if (!map) {
      map = new Map();
      this.#contextual.set(whenKey, map);
    }
    map.set(needsKey, give);
  }

  bound(abstract: Abstract): boolean {
    const key = keyOf(abstract);
    if (this.#aliases.has(key)) return true;
    const resolved = this.#resolveAlias(key);
    return this.#bindings.has(resolved) || this.#instances.has(resolved);
  }

  /** PSR-11 style: whether the abstract is bound. */
  has(id: string): boolean {
    return this.bound(id);
  }

  /** Whether the abstract has been resolved at least once. */
  resolved(abstract: Abstract): boolean {
    const key = this.#resolveAlias(keyOf(abstract));
    return this.#resolved.has(key) || this.#instances.has(key);
  }

  isShared(abstract: Abstract): boolean {
    const key = this.#resolveAlias(keyOf(abstract));
    if (this.#instances.has(key)) return true;
    return this.#bindings.get(key)?.shared === true;
  }

  isAlias(name: string): boolean {
    return this.#aliases.has(name);
  }

  getAlias(abstract: Abstract): string {
    return this.#resolveAlias(keyOf(abstract));
  }

  getBindings(): Record<string, { concrete: Concrete; shared: boolean }> {
    const out: Record<string, { concrete: Concrete; shared: boolean }> = {};
    for (const [k, v] of this.#bindings) out[k] = v;
    return out;
  }

  /** Abstract currently being built, if any. */
  currentlyResolving(): string | null {
    return this.#buildStack.at(-1) ?? null;
  }

  /** Remove cached instance and alias entries for an abstract. */
  dropStaleInstances(abstract: Abstract): void {
    const key = keyOf(abstract);
    this.#instances.delete(key);
    this.#aliases.delete(key);
  }

  /** Alias for `make`. */
  resolve<T>(
    abstract: Abstract<T>,
    parameters: Record<string, unknown> = {},
  ): T {
    return this.make(abstract, parameters);
  }

  /** Alias for `make` with explicit parameters. */
  makeWith<T>(
    abstract: Abstract<T>,
    parameters: Record<string, unknown> = {},
  ): T {
    return this.make(abstract, parameters);
  }

  /** PSR-11 style resolve. */
  get<T = unknown>(id: string): T {
    return this.make<T>(id);
  }

  /**
   * Build a concrete class or factory. For abstracts, same as `make`.
   */
  build<T>(concrete: Concrete<T> | Abstract<T>): T {
    if (typeof concrete === "string") {
      return this.make(concrete);
    }
    if (typeof concrete === "function" && isConstructor(concrete as Concrete)) {
      const key = keyOf(concrete);
      this.#fireBeforeResolving(key, this.#parameterOverride);
      const value = this.#applyExtenders(
        key,
        this.#buildClass(concrete as ClassType, key),
      ) as T;
      this.#fireResolving(key, value);
      this.#resolved.add(key);
      this.#fireAfterResolving(key, value);
      return value;
    }
    return this.#build(concrete as Concrete, keyOf(concrete)) as T;
  }

  make<T>(
    abstract: Abstract<T>,
    parameters: Record<string, unknown> = {},
  ): T {
    const key = this.#resolveAlias(keyOf(abstract));
    const previousOverride = this.#parameterOverride;
    this.#parameterOverride = parameters;
    const hasParameters = Object.keys(parameters).length > 0;

    try {
      this.#fireBeforeResolving(key, parameters);

      if (this.#buildStack.includes(key)) {
        throw new CircularDependencyError(key);
      }

      if (!hasParameters && this.#instances.has(key)) {
        const cached = this.#instances.get(key);
        this.#fireResolving(key, cached);
        this.#fireAfterResolving(key, cached);
        return cached as T;
      }

      const binding = this.#bindings.get(key);
      if (binding) {
        this.#buildStack.push(key);
        try {
          let value = this.#build(binding.concrete, key) as T;
          value = this.#applyExtenders(key, value) as T;
          if (binding.shared && !hasParameters) this.#instances.set(key, value);
          this.#resolved.add(key);
          this.#fireResolving(key, value);
          this.#fireAfterResolving(key, value);
          return value;
        } finally {
          this.#buildStack.pop();
        }
      }

      // Auto-wire unbound concrete classes
      if (
        typeof abstract === "function" &&
        isConstructor(abstract as Concrete)
      ) {
        this.#buildStack.push(key);
        try {
          let value = this.#buildClass(abstract as ClassType, key) as T;
          value = this.#applyExtenders(key, value) as T;
          this.#resolved.add(key);
          this.#fireResolving(key, value);
          this.#fireAfterResolving(key, value);
          return value;
        } finally {
          this.#buildStack.pop();
        }
      }

      throw new BindingResolutionError(key);
    } finally {
      this.#parameterOverride = previousOverride;
    }
  }

  /** Return a closure that resolves the abstract when invoked. */
  factory<T>(abstract: Abstract<T>): () => T {
    return () => this.make(abstract);
  }

  /** Return a closure that invokes `callback` with container injection. */
  wrap<T = unknown>(
    callback: (...args: never[]) => T,
    parameters: Record<string, unknown> = {},
  ): () => T {
    return () =>
      this.call(
        callback as (...args: unknown[]) => unknown,
        parameters,
      ) as T;
  }

  /**
   * Decorate a binding after it is resolved.
   * Callback receives `(service, container)` and returns the replacement.
   */
  extend<T>(abstract: Abstract<T>, closure: Extender<T>): this {
    const key = this.#resolveAlias(keyOf(abstract));
    const list = this.#extenders.get(key) ?? [];
    list.push(closure as Extender);
    this.#extenders.set(key, list);

    if (this.#instances.has(key)) {
      const current = this.#instances.get(key) as T;
      this.#instances.set(key, closure(current, this));
      this.#rebound(key);
    } else if (this.resolved(key)) {
      this.#rebound(key);
    }
    return this;
  }

  forgetExtenders(abstract: Abstract): this {
    this.#extenders.delete(this.#resolveAlias(keyOf(abstract)));
    return this;
  }

  getExtenders(abstract: Abstract): Extender[] {
    return [...(this.#extenders.get(this.#resolveAlias(keyOf(abstract))) ?? [])];
  }

  forgetInstance(abstract: Abstract): this {
    const key = this.#resolveAlias(keyOf(abstract));
    this.#instances.delete(key);
    this.#resolved.delete(key);
    return this;
  }

  forgetInstances(): this {
    this.#instances.clear();
    this.#resolved.clear();
    return this;
  }

  forgetScopedInstances(): this {
    for (const key of this.#scopedInstances) {
      this.#instances.delete(key);
    }
    return this;
  }

  flush(): this {
    this.#aliases.clear();
    this.#resolved.clear();
    this.#bindings.clear();
    this.#instances.clear();
    this.#tags.clear();
    this.#contextual.clear();
    this.#extenders.clear();
    this.#reboundCallbacks.clear();
    this.#beforeResolving.clear();
    this.#resolving.clear();
    this.#afterResolving.clear();
    this.#methodBindings.clear();
    this.#scopedInstances.clear();
    this.#globalBeforeResolving.length = 0;
    this.#globalResolving.length = 0;
    this.#globalAfterResolving.length = 0;
    this.#buildStack.length = 0;
    return this;
  }

  rebinding(abstract: Abstract, callback: ReboundCallback): unknown {
    const key = this.#resolveAlias(keyOf(abstract));
    const list = this.#reboundCallbacks.get(key) ?? [];
    list.push(callback);
    this.#reboundCallbacks.set(key, list);
    if (this.bound(abstract)) {
      return this.make(abstract);
    }
    return undefined;
  }

  /**
   * On rebind, call `target[method](newInstance)`.
   */
  refresh(abstract: Abstract, target: object, method: string): unknown {
    return this.rebinding(abstract, (_container, instance) => {
      (target as Record<string, (value: unknown) => void>)[method](instance);
    });
  }

  beforeResolving(
    abstract: Abstract | BeforeResolvingCallback,
    callback?: BeforeResolvingCallback,
  ): this {
    if (isFactoryFn(abstract) && callback == null) {
      this.#globalBeforeResolving.push(abstract as BeforeResolvingCallback);
      return this;
    }
    const key = this.#resolveAlias(keyOf(abstract));
    const list = this.#beforeResolving.get(key) ?? [];
    list.push(callback!);
    this.#beforeResolving.set(key, list);
    return this;
  }

  resolving(
    abstract: Abstract | ResolvingCallback,
    callback?: ResolvingCallback,
  ): this {
    if (isFactoryFn(abstract) && callback == null) {
      this.#globalResolving.push(abstract as ResolvingCallback);
      return this;
    }
    const key = this.#resolveAlias(keyOf(abstract));
    const list = this.#resolving.get(key) ?? [];
    list.push(callback!);
    this.#resolving.set(key, list);
    return this;
  }

  afterResolving(
    abstract: Abstract | ResolvingCallback,
    callback?: ResolvingCallback,
  ): this {
    if (isFactoryFn(abstract) && callback == null) {
      this.#globalAfterResolving.push(abstract as ResolvingCallback);
      return this;
    }
    const key = this.#resolveAlias(keyOf(abstract));
    const list = this.#afterResolving.get(key) ?? [];
    list.push(callback!);
    this.#afterResolving.set(key, list);
    return this;
  }

  bindMethod(
    method: string | [Abstract, string],
    callback: (instance: unknown, container: Container) => unknown,
  ): this {
    this.#methodBindings.set(parseBindMethod(method), callback);
    return this;
  }

  hasMethodBinding(method: string): boolean {
    return this.#methodBindings.has(method);
  }

  /**
   * Invoke `instance[method]` with method injection (`fn.inject` /
   * Reflect paramtypes), without constructing a new instance.
   */
  callMethod(
    instance: object,
    method: string,
    parameters: Record<string, unknown> = {},
  ): unknown {
    const Class = instance.constructor as Function;
    return this.#invokeBoundMethod(instance, method, Class, method, parameters);
  }

  /**
   * Invoke a closure or `[Class, method]` with container resolution.
   * Closures may declare deps via a static/own `inject` array of abstracts.
   */
  call(
    callback:
      | ((...args: unknown[]) => unknown)
      | [Abstract, string]
      | string,
    parameters: Record<string, unknown> = {},
  ): unknown {
    if (typeof callback === "string") {
      const at = callback.indexOf("@");
      if (at === -1) {
        throw new BindingResolutionError(callback);
      }
      const classKey = callback.slice(0, at);
      const method = callback.slice(at + 1);
      const methodKey = `${classKey}@${method}`;
      const instance = this.make(classKey);
      if (this.hasMethodBinding(methodKey)) {
        return this.#methodBindings.get(methodKey)!(instance, this);
      }
      return this.#invokeBoundMethod(
        instance,
        method,
        undefined,
        method,
        parameters,
      );
    }

    if (Array.isArray(callback)) {
      const [abstract, method] = callback;
      const methodKey = parseBindMethod(callback);
      const instance = this.make(abstract);
      if (this.hasMethodBinding(methodKey)) {
        return this.#methodBindings.get(methodKey)!(instance, this);
      }
      const Class =
        typeof abstract === "function" ? (abstract as Function) : undefined;
      return this.#invokeBoundMethod(
        instance,
        method,
        Class,
        method,
        parameters,
      );
    }

    const inject = (callback as { inject?: Abstract[] }).inject;
    if (Array.isArray(inject)) {
      const deps = inject.map((dep) => {
        const k = keyOf(dep);
        if (Object.prototype.hasOwnProperty.call(parameters, k)) {
          return parameters[k];
        }
        return this.make(dep);
      });
      return callback(...deps);
    }

    const keys = Object.keys(parameters);
    if (keys.length > 0) {
      return callback(...keys.map((k) => parameters[k]));
    }
    return callback(this);
  }

  /**
   * Invoke `instance[method]` with method injection:
   * `fn.inject` / Reflect paramtypes, with `parameters` overrides.
   */
  #invokeBoundMethod(
    instance: unknown,
    method: string,
    Class: Function | undefined,
    methodName: string,
    parameters: Record<string, unknown>,
  ): unknown {
    const fn = (instance as Record<string, (...args: unknown[]) => unknown>)[
      method
    ];
    if (typeof fn !== "function") {
      throw new BindingResolutionError(
        Class ? `${keyOf(Class)}@${method}` : method,
      );
    }
    const types = methodParamTypes(fn, Class, methodName);
    if (types.length === 0) {
      return fn.apply(instance, this.#valuesFromParameters(parameters));
    }
    const deps = types.map((type, index) => {
      const typeKey = keyOf(type);
      if (Object.prototype.hasOwnProperty.call(parameters, typeKey)) {
        return parameters[typeKey];
      }
      if (Object.prototype.hasOwnProperty.call(parameters, String(index))) {
        return parameters[String(index)];
      }
      return this.make(type as Abstract);
    });
    return fn.apply(instance, deps);
  }

  #register<T>(
    abstract: Abstract<T>,
    concrete: Concrete<T> | undefined,
    shared: boolean,
  ): void {
    const key = keyOf(abstract);
    this.#instances.delete(key);
    this.#aliases.delete(key);

    const resolved =
      concrete ??
      (typeof abstract === "function"
        ? (abstract as Concrete<T>)
        : undefined);
    if (!resolved) {
      throw new BindingResolutionError(key);
    }

    const alreadyResolved = this.resolved(key);
    this.#bindings.set(key, { concrete: resolved, shared });
    if (alreadyResolved) {
      this.#rebound(key);
    }
  }

  #resolveAlias(key: string): string {
    let current = key;
    const seen = new Set<string>();
    while (this.#aliases.has(current) && !seen.has(current)) {
      seen.add(current);
      current = this.#aliases.get(current)!;
    }
    return current;
  }

  #build(concrete: Concrete, forKey?: string): unknown {
    if (isConstructor(concrete)) {
      return this.#buildClass(concrete, forKey ?? keyOf(concrete));
    }
    return (concrete as (container: Container, parameters?: Record<string, unknown>) => unknown)(
      this,
      this.#parameterOverride,
    );
  }

  #buildClass(Class: ClassType, consumerKey: string): unknown {
    const types = paramTypesOf(Class);
    const deps = types.map((type, index) => {
      const typeKey = keyOf(type);
      if (Object.prototype.hasOwnProperty.call(this.#parameterOverride, typeKey)) {
        return this.#parameterOverride[typeKey];
      }
      if (
        Object.prototype.hasOwnProperty.call(
          this.#parameterOverride,
          String(index),
        )
      ) {
        return this.#parameterOverride[String(index)];
      }
      return this.#resolveDependency(consumerKey, type);
    });

    // Extra positional overrides beyond typed inject params (makeWith).
    let index = types.length;
    while (
      Object.prototype.hasOwnProperty.call(
        this.#parameterOverride,
        String(index),
      )
    ) {
      deps.push(this.#parameterOverride[String(index)]);
      index++;
    }

    if (types.length === 0) {
      const values = Object.values(this.#parameterOverride);
      if (values.length > 0) {
        return new Class(...(values as never[]));
      }
    }

    return new Class(...(deps as never[]));
  }

  #resolveDependency(consumerKey: string, type: Function): unknown {
    const needsKey = keyOf(type);
    const contextual = this.#contextual.get(consumerKey)?.get(needsKey);
    if (contextual) {
      if (contextual.type === "tagged") {
        return this.tagged(contextual.tag);
      }
      return this.#build(contextual.value, needsKey);
    }
    return this.make(type as Abstract);
  }

  #applyExtenders(key: string, value: unknown): unknown {
    const extenders = this.#extenders.get(key);
    if (!extenders?.length) return value;
    let current = value;
    for (const extender of extenders) {
      current = extender(current, this);
    }
    return current;
  }

  #rebound(abstract: string): void {
    const callbacks = this.#reboundCallbacks.get(abstract);
    if (!callbacks?.length) return;
    const instance = this.make(abstract);
    for (const callback of callbacks) {
      callback(this, instance);
    }
  }

  #fireBeforeResolving(
    abstract: string,
    parameters: Record<string, unknown>,
  ): void {
    for (const cb of this.#globalBeforeResolving) {
      cb(abstract, parameters, this);
    }
    for (const cb of this.#beforeResolving.get(abstract) ?? []) {
      cb(abstract, parameters, this);
    }
  }

  #fireResolving(abstract: string, instance: unknown): void {
    for (const cb of this.#globalResolving) {
      cb(instance, this);
    }
    for (const cb of this.#resolving.get(abstract) ?? []) {
      cb(instance, this);
    }
  }

  #fireAfterResolving(abstract: string, instance: unknown): void {
    for (const cb of this.#globalAfterResolving) {
      cb(instance, this);
    }
    for (const cb of this.#afterResolving.get(abstract) ?? []) {
      cb(instance, this);
    }
  }

  #valuesFromParameters(parameters: Record<string, unknown>): unknown[] {
    return Object.values(parameters);
  }
}

class ContextualBindingBuilder {
  constructor(
    private container: Container,
    private whenKey: string,
  ) {}

  needs(abstract: Abstract): ContextualNeedsBuilder {
    return new ContextualNeedsBuilder(
      this.container,
      this.whenKey,
      keyOf(abstract),
    );
  }
}

class ContextualNeedsBuilder {
  constructor(
    private container: Container,
    private whenKey: string,
    private needsKey: string,
  ) {}

  give(concrete: Concrete | unknown): void {
    if (typeof concrete === "function") {
      this.container.addContextual(this.whenKey, this.needsKey, {
        type: "concrete",
        value: concrete as Concrete,
      });
      return;
    }
    const value = concrete;
    this.container.addContextual(this.whenKey, this.needsKey, {
      type: "concrete",
      value: () => value,
    });
  }

  giveTagged(tag: string): void {
    this.container.addContextual(this.whenKey, this.needsKey, {
      type: "tagged",
      tag,
    });
  }
}
