import * as readline from "node:readline";

export type ValidateResult = string | void | null | undefined;
export type ValidateFn<T> = (value: T) => ValidateResult | Promise<ValidateResult>;

export type TextOptions = {
  label: string;
  placeholder?: string;
  default?: string;
  required?: boolean | string;
  validate?: ValidateFn<string>;
  hint?: string;
  transform?: (value: string) => string;
};

export type NumberOptions = {
  label: string;
  placeholder?: string;
  default?: number;
  required?: boolean | string;
  validate?: ValidateFn<number | undefined>;
  hint?: string;
  min?: number;
  max?: number;
};

export type PasswordOptions = {
  label: string;
  placeholder?: string;
  required?: boolean | string;
  validate?: ValidateFn<string>;
  hint?: string;
};

export type ConfirmOptions = {
  label: string;
  default?: boolean;
  yes?: string;
  no?: string;
  required?: boolean | string;
  hint?: string;
};

export type SelectOptions<T extends string = string> = {
  label: string;
  options: T[] | Record<string, string>;
  default?: T | string;
  hint?: string;
  validate?: ValidateFn<string>;
  scroll?: number;
};

export type MultiselectOptions<T extends string = string> = {
  label: string;
  options: T[] | Record<string, string>;
  default?: T[] | string[];
  required?: boolean | string;
  hint?: string;
  validate?: ValidateFn<string[]>;
};

export type SuggestOptions = TextOptions & {
  options: string[] | ((value: string) => string[] | Promise<string[]>);
};

export type SearchOptions = {
  label: string;
  options: (value: string) => string[] | Record<string, string> | Promise<string[] | Record<string, string>>;
  placeholder?: string;
  hint?: string;
  scroll?: number;
  validate?: ValidateFn<string>;
};

export type MultisearchOptions = {
  label: string;
  options: (value: string) => string[] | Record<string, string> | Promise<string[] | Record<string, string>>;
  placeholder?: string;
  hint?: string;
  required?: boolean | string;
  validate?: ValidateFn<string[]>;
};

type AskedPrompt = {
  type: string;
  label: string;
};

let fakeAnswers: unknown[] | null = null;
const asked: AskedPrompt[] = [];
let output: (line: string) => void = (line) => console.log(line);

/** Queue answers for non-interactive tests (`Prompt::fake`). */
export function fake(answers: unknown[] = []): void {
  fakeAnswers = [...answers];
  asked.length = 0;
}

/** Clear fake answers and restore interactive mode. */
export function restore(): void {
  fakeAnswers = null;
  asked.length = 0;
}

/** Override line writer (tests). */
export function setPromptOutput(writer: (line: string) => void): void {
  output = writer;
}

export function assertAsked(type: string, label?: string): void {
  const hit = asked.some(
    (item) => item.type === type && (label == null || item.label === label),
  );
  if (!hit) {
    throw new Error(
      label
        ? `Expected ${type} prompt [${label}] to be asked.`
        : `Expected a ${type} prompt to be asked.`,
    );
  }
}

export function assertNotAsked(type: string, label?: string): void {
  const hit = asked.some(
    (item) => item.type === type && (label == null || item.label === label),
  );
  if (hit) {
    throw new Error(
      label
        ? `Unexpected ${type} prompt [${label}] was asked.`
        : `Unexpected ${type} prompt was asked.`,
    );
  }
}

function record(type: string, label: string): void {
  asked.push({ type, label });
}

function takeFake<T>(): T {
  if (!fakeAnswers || fakeAnswers.length === 0) {
    throw new Error("Unexpected prompt with no fake answer queued.");
  }
  return fakeAnswers.shift() as T;
}

function isFake(): boolean {
  return fakeAnswers != null;
}

function normalizeLabel(
  labelOrOptions: string | { label: string },
  options?: Record<string, unknown>,
): { label: string; rest: Record<string, unknown> } {
  if (typeof labelOrOptions === "string") {
    return { label: labelOrOptions, rest: { ...(options ?? {}) } };
  }
  const { label, ...rest } = labelOrOptions;
  return { label, rest };
}

function optionEntries(
  options: string[] | Record<string, string>,
): Array<{ value: string; label: string }> {
  if (Array.isArray(options)) {
    return options.map((value) => ({ value, label: value }));
  }
  return Object.entries(options).map(([value, label]) => ({ value, label }));
}

async function readLine(hidden = false): Promise<string> {
  if (isFake()) return String(takeFake() ?? "");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true,
  });

  if (hidden && process.stdin.isTTY) {
    // Best-effort mute: still accept input; do not echo via custom handler.
    const stdin = process.stdin as NodeJS.ReadStream & {
      setRawMode?: (mode: boolean) => void;
    };
    return await new Promise<string>((resolve) => {
      let value = "";
      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === "\n" || ch === "\r" || ch === "\u0004") {
            stdin.setRawMode?.(false);
            stdin.off("data", onData);
            process.stdout.write("\n");
            rl.close();
            resolve(value);
            return;
          }
          if (ch === "\u0003") {
            stdin.setRawMode?.(false);
            process.exit(130);
          }
          if (ch === "\u007f" || ch === "\b") {
            value = value.slice(0, -1);
            continue;
          }
          value += ch;
        }
      };
      stdin.on("data", onData);
    });
  }

  return await new Promise<string>((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function runValidated<T>(
  type: string,
  label: string,
  read: () => Promise<T>,
  options: {
    required?: boolean | string;
    validate?: ValidateFn<T>;
    transform?: (value: T) => T;
    isEmpty?: (value: T) => boolean;
  } = {},
): Promise<T> {
  record(type, label);
  const isEmpty =
    options.isEmpty ??
    ((value: T) => value == null || String(value).trim() === "");

  for (;;) {
    let value = await read();
    if (options.transform) {
      value = options.transform(value as T) as Awaited<T>;
    }

    if (options.required && isEmpty(value)) {
      const message =
        typeof options.required === "string"
          ? options.required
          : "Required.";
      output(`  ${message}`);
      if (isFake()) throw new Error(message);
      continue;
    }

    if (options.validate) {
      const error = await options.validate(value);
      if (error) {
        output(`  ${error}`);
        if (isFake()) throw new Error(error);
        continue;
      }
    }

    return value;
  }
}

function printPrompt(
  label: string,
  extras: {
    placeholder?: string;
    hint?: string;
    defaultDisplay?: string;
  } = {},
): void {
  output(label);
  if (extras.hint) output(`  ${extras.hint}`);
  if (extras.placeholder) output(`  [${extras.placeholder}]`);
  if (extras.defaultDisplay != null && extras.defaultDisplay !== "") {
    process.stdout.write?.(``);
  }
}

export async function text(
  labelOrOptions: string | TextOptions,
  options?: Omit<TextOptions, "label">,
): Promise<string> {
  const { label, rest } = normalizeLabel(labelOrOptions, options);
  const opts = rest as Omit<TextOptions, "label">;
  printPrompt(label, {
    placeholder: opts.placeholder,
    hint: opts.hint,
  });

  return runValidated(
    "text",
    label,
    async () => {
      const line = await readLine();
      if (line === "" && opts.default != null) return opts.default;
      return line;
    },
    {
      required: opts.required,
      validate: opts.validate,
      transform: opts.transform,
    },
  );
}

export async function textarea(
  labelOrOptions: string | TextOptions,
  options?: Omit<TextOptions, "label">,
): Promise<string> {
  const { label, rest } = normalizeLabel(labelOrOptions, options);
  const opts = rest as Omit<TextOptions, "label">;
  printPrompt(label, {
    placeholder: opts.placeholder,
    hint: opts.hint ?? "End with a blank line.",
  });

  return runValidated(
    "textarea",
    label,
    async () => {
      if (isFake()) return String(takeFake() ?? opts.default ?? "");
      const lines: string[] = [];
      for (;;) {
        const line = await readLine();
        if (line === "") break;
        lines.push(line);
      }
      if (lines.length === 0 && opts.default != null) return opts.default;
      return lines.join("\n");
    },
    {
      required: opts.required,
      validate: opts.validate,
      transform: opts.transform,
    },
  );
}

export async function number(
  labelOrOptions: string | NumberOptions,
  options?: Omit<NumberOptions, "label">,
): Promise<number> {
  const { label, rest } = normalizeLabel(labelOrOptions, options);
  const opts = rest as Omit<NumberOptions, "label">;
  printPrompt(label, {
    placeholder: opts.placeholder,
    hint: opts.hint,
  });

  return runValidated(
    "number",
    label,
    async () => {
      const line = await readLine();
      if (line.trim() === "" && opts.default != null) return opts.default;
      return Number(line);
    },
    {
      required: opts.required,
      isEmpty: (value) => value == null || Number.isNaN(value),
      validate: async (value) => {
        if (!Number.isFinite(value)) return "Please enter a valid number.";
        if (opts.min != null && value < opts.min) {
          return `Must be at least ${opts.min}.`;
        }
        if (opts.max != null && value > opts.max) {
          return `Must be at most ${opts.max}.`;
        }
        if (opts.validate) return opts.validate(value);
      },
    },
  );
}

export async function password(
  labelOrOptions: string | PasswordOptions,
  options?: Omit<PasswordOptions, "label">,
): Promise<string> {
  const { label, rest } = normalizeLabel(labelOrOptions, options);
  const opts = rest as Omit<PasswordOptions, "label">;
  printPrompt(label, {
    placeholder: opts.placeholder,
    hint: opts.hint,
  });

  return runValidated(
    "password",
    label,
    async () => readLine(true),
    {
      required: opts.required,
      validate: opts.validate,
    },
  );
}

export async function confirm(
  labelOrOptions: string | ConfirmOptions,
  options?: Omit<ConfirmOptions, "label">,
): Promise<boolean> {
  const { label, rest } = normalizeLabel(labelOrOptions, options);
  const opts = rest as Omit<ConfirmOptions, "label">;
  const yes = opts.yes ?? "Yes";
  const no = opts.no ?? "No";
  const def = opts.default ?? true;
  printPrompt(`${label} (${yes}/${no})`, { hint: opts.hint });
  record("confirm", label);

  for (;;) {
    let value: boolean;
    if (isFake()) {
      const answer = takeFake<boolean | string>();
      if (typeof answer === "boolean") value = answer;
      else {
        const s = String(answer).toLowerCase();
        if (["y", "yes", "1", "true"].includes(s)) value = true;
        else if (["n", "no", "0", "false"].includes(s)) value = false;
        else value = def;
      }
    } else {
      const line = (await readLine()).trim().toLowerCase();
      if (line === "") value = def;
      else if (["y", "yes"].includes(line)) value = true;
      else if (["n", "no"].includes(line)) value = false;
      else {
        output("  Please answer y or n.");
        continue;
      }
    }

    if (opts.required && value !== true) {
      const message =
        typeof opts.required === "string"
          ? opts.required
          : "You must confirm.";
      output(`  ${message}`);
      if (isFake()) throw new Error(message);
      continue;
    }
    return value;
  }
}

function resolveSelectArgs(
  labelOrOptions: string | SelectOptions,
  options?: string[] | Record<string, string> | Omit<SelectOptions, "label">,
): { label: string; opts: Omit<SelectOptions, "label"> } {
  if (typeof labelOrOptions !== "string") {
    const { label, ...opts } = labelOrOptions;
    return { label, opts };
  }
  if (Array.isArray(options)) {
    return { label: labelOrOptions, opts: { options } };
  }
  if (
    options &&
    typeof options === "object" &&
    !("options" in options) &&
    !("default" in options) &&
    !("hint" in options) &&
    !("validate" in options) &&
    !("scroll" in options)
  ) {
    return {
      label: labelOrOptions,
      opts: { options: options as Record<string, string> },
    };
  }
  return {
    label: labelOrOptions,
    opts: (options as Omit<SelectOptions, "label">) ?? { options: [] },
  };
}

export async function select(
  labelOrOptions: string | SelectOptions,
  options?: string[] | Record<string, string> | Omit<SelectOptions, "label">,
): Promise<string> {
  const { label, opts } = resolveSelectArgs(labelOrOptions, options);
  const entries = optionEntries(opts.options ?? []);
  printPrompt(label, { hint: opts.hint });
  for (let i = 0; i < entries.length; i++) {
    output(`  ${i + 1}. ${entries[i]!.label}`);
  }

  return runValidated(
    "select",
    label,
    async () => {
      if (isFake()) {
        const answer = String(takeFake());
        const byValue = entries.find((e) => e.value === answer);
        if (byValue) return byValue.value;
        const byLabel = entries.find((e) => e.label === answer);
        if (byLabel) return byLabel.value;
        const idx = Number(answer);
        if (Number.isInteger(idx) && idx >= 1 && idx <= entries.length) {
          return entries[idx - 1]!.value;
        }
        return answer;
      }

      const line = (await readLine()).trim();
      if (line === "" && opts.default != null) return String(opts.default);
      const idx = Number(line);
      if (Number.isInteger(idx) && idx >= 1 && idx <= entries.length) {
        return entries[idx - 1]!.value;
      }
      const byValue = entries.find((e) => e.value === line || e.label === line);
      if (byValue) return byValue.value;
      output("  Invalid selection.");
      return "";
    },
    {
      validate: async (value) => {
        if (!value) return "Invalid selection.";
        if (opts.validate) return opts.validate(value);
      },
    },
  );
}

function resolveMultiselectArgs(
  labelOrOptions: string | MultiselectOptions,
  options?:
    | string[]
    | Record<string, string>
    | Omit<MultiselectOptions, "label">,
): { label: string; opts: Omit<MultiselectOptions, "label"> } {
  if (typeof labelOrOptions !== "string") {
    const { label, ...opts } = labelOrOptions;
    return { label, opts };
  }
  if (Array.isArray(options)) {
    return { label: labelOrOptions, opts: { options } };
  }
  if (
    options &&
    typeof options === "object" &&
    !("options" in options) &&
    !("default" in options) &&
    !("required" in options) &&
    !("hint" in options) &&
    !("validate" in options)
  ) {
    return {
      label: labelOrOptions,
      opts: { options: options as Record<string, string> },
    };
  }
  return {
    label: labelOrOptions,
    opts: (options as Omit<MultiselectOptions, "label">) ?? { options: [] },
  };
}

export async function multiselect(
  labelOrOptions: string | MultiselectOptions,
  options?:
    | string[]
    | Record<string, string>
    | Omit<MultiselectOptions, "label">,
): Promise<string[]> {
  const { label, opts } = resolveMultiselectArgs(labelOrOptions, options);
  const entries = optionEntries(opts.options ?? []);
  printPrompt(label, {
    hint: opts.hint ?? "Comma-separated numbers or values.",
  });
  for (let i = 0; i < entries.length; i++) {
    output(`  ${i + 1}. ${entries[i]!.label}`);
  }

  return runValidated(
    "multiselect",
    label,
    async () => {
      if (isFake()) {
        const answer = takeFake<string[] | string>();
        if (Array.isArray(answer)) return answer.map(String);
        return String(answer)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const line = (await readLine()).trim();
      if (line === "" && opts.default) return [...opts.default].map(String);
      if (line === "") return [];

      const parts = line.split(",").map((s) => s.trim()).filter(Boolean);
      const selected: string[] = [];
      for (const part of parts) {
        const idx = Number(part);
        if (Number.isInteger(idx) && idx >= 1 && idx <= entries.length) {
          selected.push(entries[idx - 1]!.value);
          continue;
        }
        const hit = entries.find((e) => e.value === part || e.label === part);
        if (hit) selected.push(hit.value);
      }
      return selected;
    },
    {
      required: opts.required,
      validate: opts.validate,
      isEmpty: (value) => value.length === 0,
    },
  );
}

export async function suggest(
  labelOrOptions: string | SuggestOptions,
  options?: string[] | Omit<SuggestOptions, "label">,
): Promise<string> {
  let label: string;
  let opts: Omit<SuggestOptions, "label">;

  if (typeof labelOrOptions === "string") {
    label = labelOrOptions;
    if (Array.isArray(options)) {
      opts = { options };
    } else {
      opts = (options as Omit<SuggestOptions, "label">) ?? { options: [] };
    }
  } else {
    const { label: l, ...rest } = labelOrOptions;
    label = l;
    opts = rest;
  }

  const list =
    typeof opts.options === "function"
      ? await opts.options("")
      : opts.options;
  printPrompt(label, {
    placeholder: opts.placeholder,
    hint: opts.hint ?? (list.length ? `Suggestions: ${list.join(", ")}` : undefined),
  });

  return runValidated(
    "suggest",
    label,
    async () => {
      const line = await readLine();
      if (line === "" && opts.default != null) return opts.default;
      return line;
    },
    {
      required: opts.required,
      validate: opts.validate,
      transform: opts.transform,
    },
  );
}

export async function search(
  labelOrOptions: string | SearchOptions,
  options?: Omit<SearchOptions, "label">,
): Promise<string> {
  const { label, rest } = normalizeLabel(labelOrOptions, options);
  const opts = rest as Omit<SearchOptions, "label">;
  printPrompt(label, {
    placeholder: opts.placeholder ?? "Search…",
    hint: opts.hint,
  });

  return runValidated(
    "search",
    label,
    async () => {
      if (isFake()) return String(takeFake());
      const query = await readLine();
      const found = await opts.options(query);
      const entries = optionEntries(
        Array.isArray(found)
          ? found
          : found,
      );
      if (entries.length === 0) {
        output("  No results.");
        return search({ label, ...opts });
      }
      for (let i = 0; i < entries.length; i++) {
        output(`  ${i + 1}. ${entries[i]!.label}`);
      }
      const pick = (await readLine()).trim();
      const idx = Number(pick);
      if (Number.isInteger(idx) && idx >= 1 && idx <= entries.length) {
        return entries[idx - 1]!.value;
      }
      const hit = entries.find((e) => e.value === pick || e.label === pick);
      return hit?.value ?? pick;
    },
    { validate: opts.validate },
  );
}

export async function multisearch(
  labelOrOptions: string | MultisearchOptions,
  options?: Omit<MultisearchOptions, "label">,
): Promise<string[]> {
  const { label, rest } = normalizeLabel(labelOrOptions, options);
  const opts = rest as Omit<MultisearchOptions, "label">;
  printPrompt(label, {
    placeholder: opts.placeholder ?? "Search…",
    hint: opts.hint ?? "Comma-separated selections.",
  });

  return runValidated(
    "multisearch",
    label,
    async () => {
      if (isFake()) {
        const answer = takeFake<string[] | string>();
        return Array.isArray(answer)
          ? answer.map(String)
          : String(answer).split(",").map((s) => s.trim()).filter(Boolean);
      }
      const query = await readLine();
      const found = await opts.options(query);
      const entries = optionEntries(found);
      for (let i = 0; i < entries.length; i++) {
        output(`  ${i + 1}. ${entries[i]!.label}`);
      }
      const pick = (await readLine()).trim();
      if (!pick) return [];
      const selected: string[] = [];
      for (const part of pick.split(",").map((s) => s.trim())) {
        const idx = Number(part);
        if (Number.isInteger(idx) && idx >= 1 && idx <= entries.length) {
          selected.push(entries[idx - 1]!.value);
          continue;
        }
        const hit = entries.find((e) => e.value === part || e.label === part);
        if (hit) selected.push(hit.value);
      }
      return selected;
    },
    {
      required: opts.required,
      validate: opts.validate,
      isEmpty: (value) => value.length === 0,
    },
  );
}

export async function pause(message = "Press ENTER to continue..."): Promise<void> {
  record("pause", message);
  output(message);
  if (isFake()) {
    takeFake();
    return;
  }
  await readLine();
}

export function note(message: string, title?: string): void {
  if (title) output(`${title}`);
  output(message);
}

export function info(message: string): void {
  output(`INFO  ${message}`);
}

export function warning(message: string): void {
  output(`WARN  ${message}`);
}

export function error(message: string): void {
  output(`ERROR ${message}`);
}

export function alert(message: string): void {
  output(`! ${message}`);
}

export function intro(message: string): void {
  output(`\n${message}\n`);
}

export function outro(message: string): void {
  output(`\n${message}\n`);
}

export function clear(): void {
  if (isFake()) return;
  process.stdout.write("\x1Bc");
}

export function table(
  headers: string[],
  rows: Array<Array<string | number>>,
): void {
  const widths = headers.map((h, i) =>
    Math.max(
      h.length,
      ...rows.map((row) => String(row[i] ?? "").length),
    ),
  );
  const line = (cells: Array<string | number>) =>
    cells
      .map((cell, i) => String(cell).padEnd(widths[i]!))
      .join("  ");
  output(line(headers));
  output(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) output(line(row));
}

export async function spin<T>(
  message: string,
  callback: () => T | Promise<T>,
): Promise<T> {
  record("spin", message);
  if (!isFake()) process.stdout.write(`${message}... `);
  try {
    const result = await callback();
    if (!isFake()) output("done");
    return result;
  } catch (error) {
    if (!isFake()) output("failed");
    throw error;
  }
}

export async function progress<T>(
  label: string,
  steps: T[],
  callback: (item: T, index: number) => void | Promise<void>,
): Promise<void> {
  record("progress", label);
  output(label);
  for (let i = 0; i < steps.length; i++) {
    await callback(steps[i]!, i);
    if (!isFake()) {
      output(`  [${i + 1}/${steps.length}]`);
    }
  }
}

/**
 * Facade of common prompt helpers.
 */
export const Prompt = {
  fake,
  restore,
  assertAsked,
  assertNotAsked,
  setOutput: setPromptOutput,
};

export const Prompts = {
  text,
  textarea,
  number,
  password,
  confirm,
  select,
  multiselect,
  suggest,
  search,
  multisearch,
  pause,
  note,
  info,
  warning,
  error,
  alert,
  intro,
  outro,
  clear,
  table,
  spin,
  progress,
  fake,
  restore,
  assertAsked,
  assertNotAsked,
};
