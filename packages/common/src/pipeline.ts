export type Next<T> = (passable: T) => T | Promise<T>;

export type PipeFunction<T> = (
  passable: T,
  next: Next<T>,
) => T | Promise<T>;

export type PipeObject<T> = Record<string, unknown> & {
  [method: string]: PipeFunction<T> | unknown;
};

export type PipeClass<T> = new () => PipeObject<T>;

/** A pipe: closure, instance with a handler method, or class to instantiate. */
export type Pipe<T> = PipeFunction<T> | PipeObject<T> | PipeClass<T>;

/**
 * Pass a value through a series of pipes, then a destination.
 *
 * ```ts
 * const result = await Pipeline.send(user)
 *   .through([trimName, ensureActive])
 *   .then((u) => u);
 * ```
 */
export class Pipeline<T> {
  #passable: T;
  #pipes: Pipe<T>[] = [];
  #method = "handle";
  #finally?: (passable: T) => void | Promise<void>;

  private constructor(passable: T) {
    this.#passable = passable;
  }

  static send<T>(passable: T): Pipeline<T> {
    return new Pipeline(passable);
  }

  /** Replace the pipe stack. */
  through(pipes: Pipe<T>[]): this {
    this.#pipes = [...pipes];
    return this;
  }

  /** Append one or more pipes. */
  pipe(pipes: Pipe<T> | Pipe<T>[]): this {
    const list = Array.isArray(pipes) ? pipes : [pipes];
    this.#pipes.push(...list);
    return this;
  }

  /** Method name invoked on class/object pipes (default `handle`). */
  via(method: string): this {
    this.#method = method;
    return this;
  }

  /** Always runs after the pipeline finishes (success or throw). */
  finally(callback: (passable: T) => void | Promise<void>): this {
    this.#finally = callback;
    return this;
  }

  /** Current pipe stack. */
  pipes(): Pipe<T>[] {
    return [...this.#pipes];
  }

  when(
    condition: boolean | ((pipeline: this) => boolean),
    callback: (pipeline: this) => unknown,
    defaultCallback?: (pipeline: this) => unknown,
  ): this {
    const pass = typeof condition === "function" ? condition(this) : condition;
    if (pass) callback(this);
    else if (defaultCallback) defaultCallback(this);
    return this;
  }

  unless(
    condition: boolean | ((pipeline: this) => boolean),
    callback: (pipeline: this) => unknown,
    defaultCallback?: (pipeline: this) => unknown,
  ): this {
    const pass = typeof condition === "function" ? condition(this) : condition;
    return this.when(!pass, callback, defaultCallback);
  }

  /** Run pipes then the destination callback. */
  async then<R>(destination: (passable: T) => R | Promise<R>): Promise<R> {
    let passable = this.#passable;
    try {
      const pipeline = this.#pipes.reduceRight<Next<T>>(
        (next, pipe) => {
          return async (value) => {
            const fn = this.#resolve(pipe);
            return fn(value, next);
          };
        },
        async (value) => value,
      );

      passable = await pipeline(this.#passable);
      return await destination(passable);
    } finally {
      if (this.#finally) await this.#finally(passable);
    }
  }

  /** Run pipes and return the passable. */
  thenReturn(): Promise<T> {
    return this.then((passable) => passable);
  }

  #resolve(pipe: Pipe<T>): PipeFunction<T> {
    if (typeof pipe === "function") {
      if (isConstructor(pipe)) {
        const instance = new (pipe as PipeClass<T>)();
        return bindMethod(instance, this.#method);
      }
      return pipe as PipeFunction<T>;
    }
    return bindMethod(pipe, this.#method);
  }
}

function isConstructor(fn: Function): boolean {
  // Class constructors typically have a prototype with constructor === fn
  // and are not tagged as async arrow functions.
  return (
    typeof fn === "function" &&
    fn.prototype != null &&
    fn.prototype.constructor === fn &&
    Object.getOwnPropertyNames(fn.prototype).length > 1
  );
}

function bindMethod<T>(
  instance: PipeObject<T>,
  method: string,
): PipeFunction<T> {
  const fn = instance[method];
  if (typeof fn !== "function") {
    throw new Error(`Pipeline pipe is missing method [${method}].`);
  }
  return (fn as PipeFunction<T>).bind(instance);
}
