import { expect } from "bun:test";
import { Prompt } from "@bunyad/cli";

/**
 * Result of `TestCase.command(...)` — fluent exit-code asserts.
 * Supports pre-run `expectsQuestion` / `expectsOutput` via deferred `run()`.
 */
export class PendingCommand {
  #exitCode: number;
  #output: string;
  #ran: boolean;
  #expectedOutput: string[] = [];
  #runFn?: () => Promise<{ exitCode: number; output: string }>;

  constructor(
    exitCodeOrRunner:
      | number
      | (() => Promise<{ exitCode: number; output: string }>),
    output = "",
  ) {
    if (typeof exitCodeOrRunner === "function") {
      this.#runFn = exitCodeOrRunner;
      this.#exitCode = 0;
      this.#output = "";
      this.#ran = false;
    } else {
      this.#exitCode = exitCodeOrRunner;
      this.#output = output;
      this.#ran = true;
    }
  }

  get exitCode(): number {
    return this.#exitCode;
  }

  get output(): string {
    return this.#output;
  }

  /** Queue a prompt answer before the command runs. */
  expectsQuestion(_question: string, answer: string | boolean): this {
    Prompt.fake([answer]);
    return this;
  }

  /** Assert output contains this line after run. */
  expectsOutput(line: string): this {
    this.#expectedOutput.push(line);
    return this;
  }

  async run(): Promise<this> {
    if (this.#ran) return this;
    if (!this.#runFn) return this;
    try {
      const result = await this.#runFn();
      this.#exitCode = result.exitCode;
      this.#output = result.output;
      this.#ran = true;
      for (const line of this.#expectedOutput) {
        expect(this.#output).toContain(line);
      }
    } finally {
      Prompt.restore();
    }
    return this;
  }

  async assertExitCode(code: number): Promise<this> {
    await this.run();
    expect(this.#exitCode).toBe(code);
    return this;
  }

  async assertSuccessful(): Promise<this> {
    return this.assertExitCode(0);
  }

  async assertFailed(): Promise<this> {
    await this.run();
    expect(this.#exitCode).not.toBe(0);
    return this;
  }

  async assertSee(text: string): Promise<this> {
    await this.run();
    expect(this.#output).toContain(text);
    return this;
  }

  async assertDontSee(text: string): Promise<this> {
    await this.run();
    expect(this.#output).not.toContain(text);
    return this;
  }
}
