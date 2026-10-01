/**
 * Minimal Reflect.metadata polyfill for Bun's emitDecoratorMetadata output.
 * Must load before decorated classes are evaluated.
 */

type MetaStore = Map<string | symbol, unknown>;

const metadata = new WeakMap<object, MetaStore>();

function storeFor(target: object): MetaStore {
  let map = metadata.get(target);
  if (!map) {
    map = new Map();
    metadata.set(target, map);
  }
  return map;
}

const R = Reflect as typeof Reflect & {
  metadata?: (key: string | symbol, value: unknown) => ClassDecorator;
  getMetadata?: (
    key: string | symbol,
    target: object,
    propertyKey?: string | symbol,
  ) => unknown;
  defineMetadata?: (
    key: string | symbol,
    value: unknown,
    target: object,
    propertyKey?: string | symbol,
  ) => void;
  decorate?: (
    decorators: (ClassDecorator | MethodDecorator | PropertyDecorator)[],
    target: object,
    propertyKey?: string | symbol,
    attributes?: PropertyDescriptor | null,
  ) => object | PropertyDescriptor;
};

if (typeof R.metadata !== "function") {
  R.metadata = (key, value) => {
    return function (
      target: object,
      propertyKey?: string | symbol,
      descriptor?: PropertyDescriptor,
    ) {
      storeFor(target).set(
        propertyKey === undefined ? key : `${String(key)}:${String(propertyKey)}`,
        value,
      );
      // Method/property: return the descriptor unchanged. Class: return target.
      if (arguments.length >= 3) return descriptor as never;
      return target as never;
    } as ClassDecorator;
  };
}

if (typeof R.getMetadata !== "function") {
  R.getMetadata = (key, target, propertyKey?) => {
    const store = storeFor(target);
    if (propertyKey !== undefined) {
      return store.get(`${String(key)}:${String(propertyKey)}`);
    }
    return store.get(key);
  };
}

if (typeof R.defineMetadata !== "function") {
  R.defineMetadata = (key, value, target, propertyKey?) => {
    const store = storeFor(target);
    if (propertyKey !== undefined) {
      store.set(`${String(key)}:${String(propertyKey)}`, value);
      return;
    }
    store.set(key, value);
  };
}

/**
 * Captured before the `typeof R.decorate !== "function"` narrowing below —
 * a type query on `R.decorate` taken *inside* that branch resolves to
 * `undefined` (control-flow narrowing applies to type queries too).
 */
type DecorateFn = NonNullable<typeof R.decorate>;

if (typeof R.decorate !== "function") {
  R.decorate = ((
    decorators: (ClassDecorator | MethodDecorator | PropertyDecorator)[],
    target: object,
    propertyKey?: string | symbol,
    attributes?: PropertyDescriptor | null,
  ) => {
    // Class decorator: Reflect.decorate(decorators, target)
    if (propertyKey === undefined && attributes === undefined) {
      let result: object = target;
      for (let i = decorators.length - 1; i >= 0; i--) {
        const next: unknown = (decorators[i] as ClassDecorator)(result as never);
        if (next != null && typeof next === "object") {
          result = next;
        }
      }
      return result;
    }

    // Method decorator: TS passes the method descriptor (or null; use the live one).
    // Property decorator: TS passes `void 0` — attach metadata only; do not
    // define an `undefined` field on the prototype (that hides instance values).
    const live = Object.getOwnPropertyDescriptor(
      target,
      propertyKey as string | symbol,
    );
    const methodDescriptor =
      live ??
      (attributes &&
      (typeof attributes.value === "function" ||
        typeof attributes.get === "function")
        ? attributes
        : undefined);
    let descriptor: PropertyDescriptor = methodDescriptor ?? {
      configurable: true,
      enumerable: true,
      writable: true,
      value: undefined,
    };
    let replaced = false;
    for (let i = decorators.length - 1; i >= 0; i--) {
      const next = (decorators[i] as MethodDecorator | PropertyDecorator)(
        target,
        propertyKey as string | symbol,
        descriptor,
      );
      if (
        next != null &&
        typeof next === "object" &&
        ("value" in next || "get" in next || "set" in next)
      ) {
        descriptor = next as PropertyDescriptor;
        replaced = true;
      }
    }
    if (methodDescriptor || replaced) {
      Object.defineProperty(target, propertyKey as string | symbol, descriptor);
    }
    return descriptor;
  }) as DecorateFn;
}
