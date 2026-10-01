import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cronMatches } from "./cron.ts";
import { acquireMutex, mutexFilename, releaseMutex } from "./mutex.ts";

export type ScheduleCallback = () => unknown | Promise<unknown>;

/** Minimal job surface — satisfied by `@bunyad/queue` `Job`. */
export type SchedulableJob = {
  name: string;
  queue?: string;
  handle(): void | Promise<void>;
};

export type ScheduleJobRunner = (job: SchedulableJob) => void | Promise<void>;

export type ScheduleCommandRunner = (
  command: string,
  args: string[],
) => unknown | Promise<unknown>;

/**
 * Cross-process mutex (cache mutex-lite).
 * `add` must be set-if-absent and return whether the key was created.
 */
export type ScheduleMutexStore = {
  add(key: string, seconds: number): Promise<boolean>;
  forget(key: string): Promise<boolean | void>;
};

/**
 * Optional mail hook for `emailOutput*` (wired to `Mail.raw` by the framework).
 */
export type ScheduleMailSender = (
  addresses: string[],
  subject: string,
  body: string,
) => void | Promise<void>;

type EventCallback = (event: ScheduledEvent) => void | Promise<void>;
type OutputCallback = (
  output: string,
  event: ScheduledEvent,
) => void | Promise<void>;

let jobRunner: ScheduleJobRunner | undefined;
let commandRunner: ScheduleCommandRunner | undefined;
let mutexStore: ScheduleMutexStore | undefined;
let mailSender: ScheduleMailSender | undefined;
let maintenanceMode = false;
let schedulePaused = false;
let httpClient: ((url: string) => Promise<unknown>) | undefined;

export function setScheduleJobRunner(runner: ScheduleJobRunner): void {
  jobRunner = runner;
}

export function getScheduleJobRunner(): ScheduleJobRunner | undefined {
  return jobRunner;
}

export function setScheduleCommandRunner(runner: ScheduleCommandRunner): void {
  commandRunner = runner;
}

export function getScheduleCommandRunner(): ScheduleCommandRunner | undefined {
  return commandRunner;
}

export function setScheduleMutexStore(store: ScheduleMutexStore | undefined): void {
  mutexStore = store;
}

export function getScheduleMutexStore(): ScheduleMutexStore | undefined {
  return mutexStore;
}

export function setScheduleMailSender(
  sender: ScheduleMailSender | undefined,
): void {
  mailSender = sender;
}

export function getScheduleMailSender(): ScheduleMailSender | undefined {
  return mailSender;
}

/** Test/helper: toggle maintenance mode for `evenInMaintenanceMode`. */
export function setScheduleMaintenanceMode(enabled: boolean): void {
  maintenanceMode = enabled;
}

/** Test/helper: pause the schedule for `evenWhenPaused`. */
export function setSchedulePaused(paused: boolean): void {
  schedulePaused = paused;
}

export function setScheduleHttpClient(
  client: ((url: string) => Promise<unknown>) | undefined,
): void {
  httpClient = client;
}

function minuteKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;
}

function msUntilNextMinute(now = new Date()): number {
  return Math.max(
    1000,
    (60 - now.getSeconds()) * 1000 - now.getMilliseconds(),
  );
}

function sleepInterruptible(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return Bun.sleep(ms);
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(":").map(Number);
  return { hour: h ?? 0, minute: m ?? 0 };
}

function currentEnvironment(): string {
  return process.env.APP_ENV ?? process.env.NODE_ENV ?? "local";
}

function parseClock(time: string): number {
  const { hour, minute } = parseTime(time);
  return hour * 60 + minute;
}

function clockMinutes(date: Date, timeZone?: string): number {
  if (!timeZone) return date.getHours() * 60 + date.getMinutes();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(date);
  const bag: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return Number(bag.hour) * 60 + Number(bag.minute);
}

function inTimeRange(now: number, start: number, end: number): boolean {
  if (start <= end) return now >= start && now < end;
  return now >= start || now < end;
}

function lastDayOfMonthNumber(date: Date, timeZone?: string): number {
  if (!timeZone) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const bag: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const year = Number(bag.year);
  const month = Number(bag.month);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * A single scheduled callback.
 */
export class ScheduledEvent {
  expression = "* * * * *";
  description = "";
  #withoutOverlapping = false;
  #onOneServer = false;
  #lockExpiresMs = 24 * 60 * 60 * 1000;
  #running = false;
  #mutexDir: string;
  #timezone: string | undefined;
  #defaultTimezone: string | undefined;
  #environments: string[] | undefined;
  #filters: Array<() => boolean | Promise<boolean>> = [];
  #rejects: Array<() => boolean | Promise<boolean>> = [];
  #outputPath: string | undefined;
  #appendOutput = false;
  #evenInMaintenanceMode = false;
  #evenWhenPaused = false;
  #runInBackground = false;
  #user?: string;
  #repeatSeconds?: number;
  #lastRepeatAt?: number;
  #before: EventCallback[] = [];
  #after: EventCallback[] = [];
  #onSuccess: EventCallback[] = [];
  #onFailure: EventCallback[] = [];
  #onSuccessWithOutput: OutputCallback[] = [];
  #onFailureWithOutput: OutputCallback[] = [];
  #pingBefore: string[] = [];
  #pingOnSuccess: string[] = [];
  #pingOnFailure: string[] = [];
  #lastOutput = "";
  #mutexNameResolver?: () => string;
  #emailOutputTo: string[] = [];
  #emailFailureOutputTo: string[] = [];

  constructor(
    readonly callback: ScheduleCallback,
    mutexDir: string,
    defaultTimezone?: string,
  ) {
    this.#mutexDir = mutexDir;
    this.#defaultTimezone = defaultTimezone;
  }

  cron(expression: string): this {
    this.expression = expression;
    return this;
  }

  /** Replace a 1-based cron field (1=minute … 5=dow). */
  spliceIntoPosition(position: number, value: string | number): this {
    const segments = this.expression.split(/\s+/);
    while (segments.length < 5) segments.push("*");
    segments[position - 1] = String(value);
    return this.cron(segments.join(" "));
  }

  everySecond(): this {
    return this.repeatEvery(1);
  }

  everyTwoSeconds(): this {
    return this.repeatEvery(2);
  }

  everyFiveSeconds(): this {
    return this.repeatEvery(5);
  }

  everyTenSeconds(): this {
    return this.repeatEvery(10);
  }

  everyFifteenSeconds(): this {
    return this.repeatEvery(15);
  }

  everyTwentySeconds(): this {
    return this.repeatEvery(20);
  }

  everyThirtySeconds(): this {
    return this.repeatEvery(30);
  }

  everyMinute(): this {
    return this.cron("* * * * *");
  }

  everyTwoMinutes(): this {
    return this.cron("*/2 * * * *");
  }

  everyThreeMinutes(): this {
    return this.cron("*/3 * * * *");
  }

  everyFourMinutes(): this {
    return this.cron("*/4 * * * *");
  }

  everyFiveMinutes(): this {
    return this.cron("*/5 * * * *");
  }

  everyTenMinutes(): this {
    return this.cron("*/10 * * * *");
  }

  everyFifteenMinutes(): this {
    return this.cron("*/15 * * * *");
  }

  everyThirtyMinutes(): this {
    return this.cron("*/30 * * * *");
  }

  hourly(): this {
    return this.cron("0 * * * *");
  }

  hourlyAt(offset: number | number[]): this {
    const offsets = Array.isArray(offset) ? offset : [offset];
    return this.hourBasedSchedule(offsets.join(","), "*");
  }

  everyOddHour(offset: number | number[] = 0): this {
    const offsets = Array.isArray(offset) ? offset : [offset];
    return this.hourBasedSchedule(offsets.join(","), "1-23/2");
  }

  everyTwoHours(offset: number | number[] = 0): this {
    const offsets = Array.isArray(offset) ? offset : [offset];
    return this.hourBasedSchedule(offsets.join(","), "*/2");
  }

  everyThreeHours(offset: number | number[] = 0): this {
    const offsets = Array.isArray(offset) ? offset : [offset];
    return this.hourBasedSchedule(offsets.join(","), "*/3");
  }

  everyFourHours(offset: number | number[] = 0): this {
    const offsets = Array.isArray(offset) ? offset : [offset];
    return this.hourBasedSchedule(offsets.join(","), "*/4");
  }

  everySixHours(offset: number | number[] = 0): this {
    const offsets = Array.isArray(offset) ? offset : [offset];
    return this.hourBasedSchedule(offsets.join(","), "*/6");
  }

  /** Set minute + hour fields while preserving the rest of the expression. */
  hourBasedSchedule(minutes: string | number, hours: string | number): this {
    return this.spliceIntoPosition(1, minutes).spliceIntoPosition(2, hours);
  }

  daily(): this {
    return this.cron("0 0 * * *");
  }

  /** `HH:MM` in the event timezone (or local). */
  dailyAt(time: string): this {
    const { hour, minute } = parseTime(time);
    return this.spliceIntoPosition(1, minute).spliceIntoPosition(2, hour);
  }

  at(time: string): this {
    return this.dailyAt(time);
  }

  twiceDaily(first = 1, second = 13): this {
    return this.cron(`0 ${first},${second} * * *`);
  }

  twiceDailyAt(first = 1, second = 13, offset = 0): this {
    return this.cron(`${offset} ${first},${second} * * *`);
  }

  /** Sundays at midnight. */
  weekly(): this {
    return this.cron("0 0 * * 0");
  }

  /** Run weekly on `dayOfWeek` (0=Sun … 6=Sat) at `HH:MM`. */
  weeklyOn(dayOfWeek: number | number[], time = "0:0"): this {
    const { hour, minute } = parseTime(time);
    const days = Array.isArray(dayOfWeek) ? dayOfWeek.join(",") : dayOfWeek;
    return this.cron(`${minute} ${hour} * * ${days}`);
  }

  /** First day of each month at midnight. */
  monthly(): this {
    return this.cron("0 0 1 * *");
  }

  /** Run monthly on `dayOfMonth` at `HH:MM`. */
  monthlyOn(dayOfMonth: number, time = "0:0"): this {
    const { hour, minute } = parseTime(time);
    return this.cron(`${minute} ${hour} ${dayOfMonth} * *`);
  }

  twiceMonthly(first = 1, second = 16, time = "0:0"): this {
    const { hour, minute } = parseTime(time);
    return this.cron(`${minute} ${hour} ${first},${second} * *`);
  }

  lastDayOfMonth(time = "0:0"): this {
    const { hour, minute } = parseTime(time);
    this.cron(`${minute} ${hour} * * *`);
    return this.when(() => {
      const now = new Date();
      const tz = this.#timezone ?? this.#defaultTimezone;
      const day = tz
        ? Number(
            new Intl.DateTimeFormat("en-US", {
              timeZone: tz,
              day: "numeric",
            }).format(now),
          )
        : now.getDate();
      return day === lastDayOfMonthNumber(now, tz);
    });
  }

  quarterly(): this {
    return this.cron("0 0 1 1-12/3 *");
  }

  quarterlyOn(dayOfQuarter = 1, time = "0:0"): this {
    const { hour, minute } = parseTime(time);
    return this.cron(`${minute} ${hour} ${dayOfQuarter} 1-12/3 *`);
  }

  yearly(): this {
    return this.cron("0 0 1 1 *");
  }

  yearlyOn(month = 1, dayOfMonth: number | string = 1, time = "0:0"): this {
    const { hour, minute } = parseTime(time);
    const day = typeof dayOfMonth === "string" ? Number(dayOfMonth) : dayOfMonth;
    return this.cron(`${minute} ${hour} ${day} ${month} *`);
  }

  days(days: number | number[]): this {
    const list = Array.isArray(days) ? days.join(",") : String(days);
    const [min = "*", hour = "*", dom = "*", month = "*"] =
      this.expression.split(/\s+/);
    return this.cron(`${min} ${hour} ${dom} ${month} ${list}`);
  }

  daysOfMonth(...days: number[]): this {
    const [min = "*", hour = "*", , month = "*", dow = "*"] =
      this.expression.split(/\s+/);
    return this.cron(`${min} ${hour} ${days.join(",")} ${month} ${dow}`);
  }

  sundays(): this {
    return this.days(0);
  }

  mondays(): this {
    return this.days(1);
  }

  tuesdays(): this {
    return this.days(2);
  }

  wednesdays(): this {
    return this.days(3);
  }

  thursdays(): this {
    return this.days(4);
  }

  fridays(): this {
    return this.days(5);
  }

  saturdays(): this {
    return this.days(6);
  }

  weekdays(): this {
    const [min = "*", hour = "*"] = this.expression.split(/\s+/);
    return this.cron(`${min} ${hour} * * 1-5`);
  }

  weekends(): this {
    const [min = "*", hour = "*"] = this.expression.split(/\s+/);
    return this.cron(`${min} ${hour} * * 0,6`);
  }

  /** Only run when `APP_ENV` / `NODE_ENV` is one of these. */
  environments(...envs: string[]): this {
    this.#environments = envs;
    return this;
  }

  runsInEnvironment(env: string): boolean {
    if (!this.#environments || this.#environments.length === 0) return true;
    return this.#environments.includes(env);
  }

  evenInMaintenanceMode(): this {
    this.#evenInMaintenanceMode = true;
    return this;
  }

  evenWhenPaused(): this {
    this.#evenWhenPaused = true;
    return this;
  }

  runsInMaintenanceMode(): boolean {
    return this.#evenInMaintenanceMode;
  }

  runsWhenPaused(): boolean {
    return this.#evenWhenPaused;
  }

  /** Additional truthy filter before running. */
  when(callback: () => boolean | Promise<boolean>): this {
    this.#filters.push(callback);
    return this;
  }

  /** Skip when callback is truthy. */
  skip(callback: () => boolean | Promise<boolean>): this {
    this.#rejects.push(callback);
    return this;
  }

  between(start: string, end: string): this {
    return this.when(() => {
      const tz = this.#timezone ?? this.#defaultTimezone;
      const now = clockMinutes(new Date(), tz);
      return inTimeRange(now, parseClock(start), parseClock(end));
    });
  }

  unlessBetween(start: string, end: string): this {
    return this.skip(() => {
      const tz = this.#timezone ?? this.#defaultTimezone;
      const now = clockMinutes(new Date(), tz);
      return inTimeRange(now, parseClock(start), parseClock(end));
    });
  }

  /** Write callback/command result string to a file (overwrite). */
  sendOutputTo(path: string): this {
    this.#outputPath = path;
    this.#appendOutput = false;
    return this;
  }

  /** Append callback/command result string to a file. */
  appendOutputTo(path: string): this {
    this.#outputPath = path;
    this.#appendOutput = true;
    return this;
  }

  /** IANA timezone for cron matching (e.g. `UTC`, `America/New_York`). */
  timezone(tz: string): this {
    this.#timezone = tz;
    return this;
  }

  name(value: string): this {
    this.description = value;
    return this;
  }

  getExpression(): string {
    return this.expression;
  }

  getSummaryForDisplay(): string {
    return this.description || this.expression;
  }

  tap(callback: (event: this) => void): this {
    callback(this);
    return this;
  }

  before(callback: EventCallback): this {
    this.#before.push(callback);
    return this;
  }

  after(callback: EventCallback): this {
    this.#after.push(callback);
    return this;
  }

  then(callback: EventCallback): this {
    return this.after(callback);
  }

  thenWithOutput(callback: OutputCallback): this {
    return this.onSuccessWithOutput(callback);
  }

  onSuccess(callback: EventCallback): this {
    this.#onSuccess.push(callback);
    return this;
  }

  onFailure(callback: EventCallback): this {
    this.#onFailure.push(callback);
    return this;
  }

  onSuccessWithOutput(callback: OutputCallback): this {
    this.#onSuccessWithOutput.push(callback);
    return this;
  }

  onFailureWithOutput(callback: OutputCallback): this {
    this.#onFailureWithOutput.push(callback);
    return this;
  }

  pingBefore(url: string): this {
    this.#pingBefore.push(url);
    return this;
  }

  pingBeforeIf(condition: boolean, url: string): this {
    if (condition) this.pingBefore(url);
    return this;
  }

  thenPing(url: string): this {
    return this.pingOnSuccess(url);
  }

  thenPingIf(condition: boolean, url: string): this {
    if (condition) this.thenPing(url);
    return this;
  }

  pingOnSuccess(url: string): this {
    this.#pingOnSuccess.push(url);
    return this;
  }

  pingOnSuccessIf(condition: boolean, url: string): this {
    if (condition) this.pingOnSuccess(url);
    return this;
  }

  pingOnFailure(url: string): this {
    this.#pingOnFailure.push(url);
    return this;
  }

  pingOnFailureIf(condition: boolean, url: string): this {
    if (condition) this.pingOnFailure(url);
    return this;
  }

  pingCallback(urls: string[]): this {
    for (const url of urls) this.pingBefore(url);
    return this;
  }

  createMutexNameUsing(resolver: () => string): this {
    this.#mutexNameResolver = resolver;
    return this;
  }

  mutexName(): string {
    return this.#mutexNameResolver?.() ?? this.#lockName();
  }

  storeOutput(): this {
    return this;
  }

  emailOutputTo(...addresses: string[]): this {
    this.#emailOutputTo.push(...addresses);
    return this;
  }

  emailOutput(...addresses: string[]): this {
    return this.emailOutputTo(...addresses);
  }

  /**
   * Email output only when non-empty (alias of `emailOutputTo`; empty bodies are skipped).
   */
  emailWrittenOutputTo(...addresses: string[]): this {
    return this.emailOutputTo(...addresses);
  }

  emailOutputOnFailure(...addresses: string[]): this {
    this.#emailFailureOutputTo.push(...addresses);
    return this;
  }

  getHttpClient(): ((url: string) => Promise<unknown>) | undefined {
    return httpClient;
  }

  runInBackground(): this {
    this.#runInBackground = true;
    return this;
  }

  user(username: string): this {
    this.#user = username;
    return this;
  }

  /**
   * Repeat within the minute every `seconds` (requires frequent `work()` ticks).
   */
  repeatEvery(seconds: number): this {
    if (seconds < 1) throw new Error("repeatEvery seconds must be >= 1");
    this.#repeatSeconds = seconds;
    this.expression = "* * * * *";
    return this;
  }

  isRepeatable(): boolean {
    return this.#repeatSeconds != null;
  }

  shouldRepeatNow(now = new Date()): boolean {
    if (this.#repeatSeconds == null) return false;
    const ts = now.getTime();
    if (this.#lastRepeatAt == null) return true;
    return ts - this.#lastRepeatAt >= this.#repeatSeconds * 1000;
  }

  /**
   * Skip if a previous run is still in-flight, or if a mutex is held
   * (`expiresMinutes`, default 24h). Uses cache store when configured.
   */
  withoutOverlapping(expiresMinutes = 1440): this {
    this.#withoutOverlapping = true;
    this.#lockExpiresMs = expiresMinutes * 60_000;
    return this;
  }

  /**
   * Only one server runs this event per minute (requires `setScheduleMutexStore`).
   */
  onOneServer(): this {
    this.#onOneServer = true;
    return this;
  }

  isDue(date: Date): boolean {
    if (maintenanceMode && !this.#evenInMaintenanceMode) return false;
    if (schedulePaused && !this.#evenWhenPaused) return false;
    if (this.#environments && this.#environments.length > 0) {
      if (!this.#environments.includes(currentEnvironment())) return false;
    }
    const tz = this.#timezone ?? this.#defaultTimezone;
    if (!cronMatches(this.expression, date, tz)) return false;
    if (this.#repeatSeconds != null) return this.shouldRepeatNow(date);
    return true;
  }

  nextRunDate(current = new Date(), nth = 0): Date {
    const cursor = new Date(current);
    cursor.setSeconds(0, 0);
    let found = -1;
    for (let i = 0; i < 60 * 24 * 366; i += 1) {
      if (this.isDue(cursor)) {
        found += 1;
        if (found === nth) return new Date(cursor);
      }
      cursor.setMinutes(cursor.getMinutes() + 1);
    }
    throw new Error("Unable to determine next run date.");
  }

  #lockName(): string {
    return this.description || this.expression;
  }

  #lockPath(): string {
    return resolve(this.#mutexDir, mutexFilename(this.mutexName()));
  }

  async #passesFilters(): Promise<boolean> {
    for (const filter of this.#filters) {
      if (!(await filter())) return false;
    }
    for (const reject of this.#rejects) {
      if (await reject()) return false;
    }
    return true;
  }

  async #writeOutput(result: unknown): Promise<void> {
    const text =
      result == null
        ? ""
        : typeof result === "string"
          ? result
          : `${JSON.stringify(result)}\n`;
    this.#lastOutput = text;
    if (!this.#outputPath || result == null) return;
    const full = resolve(this.#outputPath);
    await mkdir(dirname(full), { recursive: true });
    if (this.#appendOutput) {
      await appendFile(full, text.endsWith("\n") ? text : `${text}\n`);
    } else {
      await writeFile(full, text.endsWith("\n") ? text : `${text}\n`);
    }
  }

  async #sendEmailOutput(failed: boolean): Promise<void> {
    const sender = mailSender;
    if (!sender) return;
    const addresses = failed
      ? this.#emailFailureOutputTo
      : this.#emailOutputTo;
    if (addresses.length === 0) return;
    const body = this.#lastOutput;
    // Skip empty success emails (Laravel 12+ / emailWrittenOutputTo semantics).
    if (!failed && !body.trim()) return;
    const label = this.getSummaryForDisplay();
    const subject = failed
      ? `Scheduled Job Failed: ${label}`
      : `Scheduled Job Output: ${label}`;
    try {
      await sender([...addresses], subject, body);
    } catch {
      // Ignore mail failures — scheduling should continue.
    }
  }

  async #ping(urls: string[]): Promise<void> {
    const client =
      httpClient ??
      (async (url: string) => {
        await fetch(url, { method: "GET" });
      });
    for (const url of urls) {
      try {
        await client(url);
      } catch {
        // Ignore ping failures — scheduling should continue.
      }
    }
  }

  async run(now = new Date()): Promise<void> {
    if (!(await this.#passesFilters())) return;
    if (this.#withoutOverlapping && this.#running) return;

    let release: (() => Promise<void>) | undefined;

    if (this.#onOneServer) {
      const store = mutexStore;
      if (!store) {
        throw new Error(
          "onOneServer() requires setScheduleMutexStore().",
        );
      }
      const key = `schedule:one:${this.mutexName()}:${minuteKey(now)}`;
      const acquired = await store.add(key, 60);
      if (!acquired) return;
    }

    if (this.#withoutOverlapping) {
      const store = mutexStore;
      if (store) {
        const key = `schedule:overlap:${this.mutexName()}`;
        const seconds = Math.max(1, Math.ceil(this.#lockExpiresMs / 1000));
        const acquired = await store.add(key, seconds);
        if (!acquired) return;
        release = async () => {
          await store.forget(key);
        };
      } else {
        const path = this.#lockPath();
        const acquired = await acquireMutex(path, this.#lockExpiresMs);
        if (!acquired) return;
        release = async () => {
          await releaseMutex(path);
        };
      }
    }

    this.#running = true;
    if (this.#repeatSeconds != null) this.#lastRepeatAt = now.getTime();
    try {
      await this.#ping(this.#pingBefore);
      for (const cb of this.#before) await cb(this);

      const execute = async () => {
        const result = await this.callback();
        await this.#writeOutput(result);
        for (const cb of this.#onSuccess) await cb(this);
        for (const cb of this.#onSuccessWithOutput) {
          await cb(this.#lastOutput, this);
        }
        await this.#sendEmailOutput(false);
        await this.#ping(this.#pingOnSuccess);
        return result;
      };

      try {
        if (this.#runInBackground) {
          void execute().catch(async () => {
            for (const cb of this.#onFailure) await cb(this);
            for (const cb of this.#onFailureWithOutput) {
              await cb(this.#lastOutput, this);
            }
            await this.#sendEmailOutput(true);
            await this.#ping(this.#pingOnFailure);
          });
        } else {
          await execute();
        }
      } catch (error) {
        for (const cb of this.#onFailure) await cb(this);
        for (const cb of this.#onFailureWithOutput) {
          await cb(this.#lastOutput, this);
        }
        await this.#sendEmailOutput(true);
        await this.#ping(this.#pingOnFailure);
        throw error;
      } finally {
        for (const cb of this.#after) await cb(this);
      }
    } finally {
      this.#running = false;
      if (release) await release();
    }
  }
}

export type ScheduleOptions = {
  /** Directory for withoutOverlapping lock files (when no cache store). */
  mutexPath?: string;
  /** Default IANA timezone for events that do not set their own. */
  timezone?: string;
};

/**
 * Task scheduler.
 */
export class Schedule {
  readonly #events: ScheduledEvent[] = [];
  readonly #mutexPath: string;
  readonly #timezone: string | undefined;
  readonly #lastRun = new Map<ScheduledEvent, string>();

  constructor(options: ScheduleOptions = {}) {
    this.#mutexPath =
      options.mutexPath ??
      resolve(process.cwd(), "storage/framework/schedule");
    this.#timezone = options.timezone;
  }

  clear(): void {
    this.#events.length = 0;
    this.#lastRun.clear();
  }

  /** Registered events. */
  events(): ScheduledEvent[] {
    return [...this.#events];
  }

  dueEvents(now = new Date()): ScheduledEvent[] {
    return this.#events.filter((event) => event.isDue(now));
  }

  eventsForEnvironments(env = currentEnvironment()): ScheduledEvent[] {
    return this.#events.filter((event) => event.runsInEnvironment(env));
  }

  call(callback: ScheduleCallback): ScheduledEvent {
    const event = new ScheduledEvent(
      callback,
      this.#mutexPath,
      this.#timezone,
    );
    this.#events.push(event);
    return event;
  }

  /**
   * Dispatch a queue job when due. Requires `setScheduleJobRunner()`.
   */
  job(job: SchedulableJob): ScheduledEvent {
    return this.call(async () => {
      const runner = jobRunner;
      if (!runner) {
        throw new Error(
          "Schedule job runner is not configured. Call setScheduleJobRunner().",
        );
      }
      await runner(job);
    }).name(`job:${job.name}`);
  }

  /**
   * Run a CLI command when due (`queue:status`, `inspire`, …).
   * Requires `setScheduleCommandRunner()`. Accepts a signature string or Command class.
   */
  command(
    signatureOrClass:
      | string
      | (abstract new (...args: never[]) => { constructor: { signature?: string } }),
  ): ScheduledEvent {
    let signature: string;
    if (typeof signatureOrClass === "string") {
      signature = signatureOrClass;
    } else {
      const ctor = signatureOrClass as {
        signature?: string;
        name?: string;
      };
      signature = ctor.signature ?? ctor.name ?? "";
      // Prefer command name only (no args) for class form
      const name = signature.split(/\s+\{/)[0]?.trim() || signature;
      signature = name;
    }
    const parts = signature.trim().split(/\s+/).filter(Boolean);
    const command = parts[0] ?? "";
    const args = parts.slice(1);
    return this.call(async () => {
      const runner = commandRunner;
      if (!runner) {
        throw new Error(
          "Schedule command runner is not configured. Call setScheduleCommandRunner().",
        );
      }
      return runner(command, args);
    }).name(`command:${signature}`);
  }

  /** Run a shell command via `Bun.spawn`. */
  exec(command: string): ScheduledEvent {
    return this.call(async () => {
      const proc = Bun.spawn(["sh", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) {
        throw new Error(
          `Scheduled exec failed (${code}): ${stderr || stdout}`,
        );
      }
      return stdout;
    }).name(`exec:${command}`);
  }

  /**
   * Register events inside `callback`, then apply shared fluent attributes
   * to all of them via the returned group.
   */
  group(callback: () => void): ScheduleEventGroup {
    const start = this.#events.length;
    callback();
    return new ScheduleEventGroup(this.#events.slice(start));
  }

  /** Run due events immediately (alias of `run`). */
  async dispatchNow(now = new Date()): Promise<number> {
    return this.run(now);
  }

  /** Run all events due at `now` (defaults to current minute). */
  async run(now = new Date()): Promise<number> {
    const key = minuteKey(now);
    let ran = 0;
    for (const event of this.#events) {
      if (!event.isDue(now)) continue;
      if (event.isRepeatable()) {
        await event.run(now);
        ran += 1;
        continue;
      }
      if (this.#lastRun.get(event) === key) continue;
      await event.run(now);
      this.#lastRun.set(event, key);
      ran += 1;
    }
    return ran;
  }

  /**
   * Daemon: run due events, then sleep until the next minute
   * (or 1s when any event uses `repeatEvery` / every*Seconds).
   * Pass `{ once: true }` to exit after one tick (useful in tests).
   * Pass `signal` to stop on abort (SIGINT/SIGTERM via `shutdownSignal()`).
   */
  async work(
    options: {
      once?: boolean;
      onTick?: (ran: number) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<number> {
    let total = 0;
    while (!options.signal?.aborted) {
      const ran = await this.run();
      total += ran;
      options.onTick?.(ran);
      if (options.once) return total;
      const hasRepeatable = this.#events.some((e) => e.isRepeatable());
      await sleepInterruptible(
        hasRepeatable ? 1000 : msUntilNextMinute(),
        options.signal,
      );
    }
    return total;
  }

  /** List registered events. */
  list(): Array<{
    expression: string;
    description: string;
    nextRun?: string;
  }> {
    return this.#events.map((e) => {
      let nextRun: string | undefined;
      try {
        nextRun = e.nextRunDate().toISOString();
      } catch {
        nextRun = undefined;
      }
      return {
        expression: e.expression,
        description: e.description || "(anonymous)",
        nextRun,
      };
    });
  }
}

/**
 * Applies shared fluent attributes to every event registered in a `group()`.
 */
export class ScheduleEventGroup {
  constructor(readonly events: ScheduledEvent[]) {}

  #each(fn: (event: ScheduledEvent) => void): this {
    for (const event of this.events) fn(event);
    return this;
  }

  daily(): this {
    return this.#each((e) => e.daily());
  }

  hourly(): this {
    return this.#each((e) => e.hourly());
  }

  weekly(): this {
    return this.#each((e) => e.weekly());
  }

  monthly(): this {
    return this.#each((e) => e.monthly());
  }

  everyMinute(): this {
    return this.#each((e) => e.everyMinute());
  }

  cron(expression: string): this {
    return this.#each((e) => e.cron(expression));
  }

  timezone(tz: string): this {
    return this.#each((e) => e.timezone(tz));
  }

  environments(...envs: string[]): this {
    return this.#each((e) => e.environments(...envs));
  }

  withoutOverlapping(expiresMinutes = 1440): this {
    return this.#each((e) => e.withoutOverlapping(expiresMinutes));
  }

  onOneServer(): this {
    return this.#each((e) => e.onOneServer());
  }

  when(callback: () => boolean | Promise<boolean>): this {
    return this.#each((e) => e.when(callback));
  }

  skip(callback: () => boolean | Promise<boolean>): this {
    return this.#each((e) => e.skip(callback));
  }
}

let defaultSchedule: Schedule | undefined;

export function setSchedule(schedule: Schedule): void {
  defaultSchedule = schedule;
}

export function getSchedule(): Schedule {
  return defaultSchedule ?? (defaultSchedule = new Schedule());
}

/** `Schedule` facade helper. */
export function schedule(): Schedule {
  return getSchedule();
}
