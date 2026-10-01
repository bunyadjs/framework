import {
  bindSignatureInput,
  parseSignature,
  type BoundInput,
  type ParsedSignature,
} from "./signature.ts";
import {
  argvFromCallArgs,
  getClosureCommandHandlers,
  getProviderCommandHandlers,
} from "./command-registry.ts";

type CommandCtor = typeof Command & {
  signature?: string;
  description?: string;
};

type CommandRunner = (
  name: string,
  args: string[],
) => Promise<number | void>;

let commandRunner: CommandRunner | undefined;

/** Live `this.call` to the CLI `run` merge (built-ins + app + closures). */
export function setCommandRunner(runner: CommandRunner | undefined): void {
  commandRunner = runner;
}

/** Console command: signature, arguments, options, and `handle()`. */
export class Command {
  static signature = "";
  static description = "";

  #tokens: string[] = [];
  #input: BoundInput = { arguments: {}, options: {} };
  #parsed: ParsedSignature = { name: "", arguments: [], options: [] };

  bindInput(argv: string[]): this {
    this.#tokens = argv.slice();
    const ctor = this.constructor as CommandCtor;
    this.#parsed = parseSignature(ctor.signature ?? "");
    this.#input = bindSignatureInput(this.#parsed, argv);
    return this;
  }

  /** Signature metadata used by required-arg prompting. */
  parsedSignature(): ParsedSignature {
    return this.#parsed;
  }

  argument(name: string): string | string[] | undefined {
    return this.#input.arguments[name];
  }

  option(name: string): string | boolean | undefined {
    return this.#input.options[name];
  }

  /** Tokens after the command name, including unknown flags. */
  tokens(): string[] {
    return this.#tokens.slice();
  }

  info(message: string): void {
    console.log(message);
  }

  line(message = ""): void {
    console.log(message);
  }

  comment(message: string): void {
    console.log(message);
  }

  warn(message: string): void {
    console.warn(message);
  }

  error(message: string): void {
    console.error(message);
  }

  newLine(count = 1): void {
    for (let i = 0; i < count; i++) {
      console.log("");
    }
  }

  async confirm(question: string, defaultValue = false): Promise<boolean> {
    const { confirm } = await import("./prompts.ts");
    return confirm(question, { default: defaultValue });
  }

  async ask(question: string, defaultValue?: string): Promise<string> {
    const { text } = await import("./prompts.ts");
    return text(question, { default: defaultValue });
  }

  /**
   * Prompt (or fail) for required arguments that were not passed.
   * Returns false when the command should not run.
   */
  async ensureRequiredArguments(): Promise<boolean> {
    for (const argument of this.#parsed.arguments) {
      if (argument.optional || argument.array) continue;
      const current = this.#input.arguments[argument.name];
      if (current != null && current !== "") continue;
      try {
        const answer = await this.ask(`${argument.name}`);
        if (answer === "" || answer == null) {
          this.error(`Missing required argument [${argument.name}].`);
          return false;
        }
        this.#input.arguments[argument.name] = answer;
      } catch {
        this.error(`Missing required argument [${argument.name}].`);
        return false;
      }
    }
    return true;
  }

  /**
   * Run another console command in-process (`$this->call`).
   */
  async call(
    name: string,
    args?: string[] | Record<string, string | boolean | number | undefined>,
  ): Promise<number> {
    const argv = argvFromCallArgs(args);
    if (commandRunner) {
      const code = await commandRunner(name, argv);
      return typeof code === "number" ? code : Number(process.exitCode ?? 0);
    }
    const closures = {
      ...getProviderCommandHandlers(),
      ...getClosureCommandHandlers(),
    };
    const handler = closures[name];
    if (!handler) {
      throw new Error(
        `Command [${name}] is not defined. Call setCommandRunner() from the CLI.`,
      );
    }
    await handler(argv);
    return Number(process.exitCode ?? 0);
  }

  async handle(): Promise<number | void> {
    throw new Error(
      `Command [${(this.constructor as CommandCtor).signature || this.constructor.name}] must implement handle().`,
    );
  }
}

export function Signature(value: string) {
  return (target: CommandCtor) => {
    target.signature = value;
  };
}

export function Description(value: string) {
  return (target: CommandCtor) => {
    target.description = value;
  };
}

export function commandName(ctor: CommandCtor): string {
  return parseSignature(ctor.signature ?? "").name;
}

export function commandDescription(ctor: CommandCtor): string {
  return ctor.description ?? "";
}

export { parseSignature, bindSignatureInput };
