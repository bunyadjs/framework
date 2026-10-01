---
title: Console
description: Run built-in commands, write your own, and open a shell against a booted application.
---

# Console

## Introduction

`bunyad` is the command-line entry for an application. With no arguments it lists commands. Pass a name to run one:

```shell
bunyad list
bunyad serve
bunyad migrate
```

Built-in commands cover the development server, migrations, queues, the scheduler, code generation, and [compilation](/docs/1.x/compiler). `bunyad list` prints those names, then an **Application commands** section for classes under `app/Console/Commands`.

An unknown name prints `Command "..." is not defined.` and exits with status 1.

`bunyad about` prints the application name, version, environment, and the Bun version. `--json` prints the same fields as JSON.

## Writing commands

### Generating commands

`make:command` writes a class under `app/Console/Commands`. `--force` overwrites an existing file.

```shell
bunyad make:command SendEmail
```

That creates `app/Console/Commands/SendEmailCommand.ts` with the signature `send:email`. The file is discovered on the next `bunyad` run. You do not register it in a list.

### Command structure

A command extends `Command` and implements `handle`. The signature is the name plus arguments and options. `static description` is the line `bunyad list` prints next to the name.

```ts
import { Command } from "@bunyad/cli/command";
import User from "@/Models/User.ts";

export default class SendEmailCommand extends Command {
  static signature = "send:email {user} {--queue}";
  static description = "Send a marketing email to a user";

  async handle(): Promise<number> {
    const user = await User.find(this.argument("user"));

    this.info(`Sending mail to ${user?.email}`);

    return 0;
  }
}
```

A number returned from `handle` becomes the process exit code. `0` is success.

`@Signature` and `@Description` set the same two static fields:

```ts
import { Command, Description, Signature } from "@bunyad/cli/command";

@Signature("send:email {user} {--queue}")
@Description("Send a marketing email to a user")
export default class SendEmailCommand extends Command {
  async handle(): Promise<number> {
    return 0;
  }
}
```

Any export that extends `Command` is registered, including a named export. The class must live under `app/Console/Commands`, in that directory or a subdirectory. Test files are skipped. If an application command uses the same name as a built-in, the application command is the one that runs.

## Defining input

The signature string is the command name, then tokens in braces.

### Arguments

`{user}` is required in the signature, but a missing value does not stop the command: `argument("user")` is `undefined` and `handle` still runs. `{user?}` is optional. `{user=ada}` is optional and defaults to `ada`. `{ids*}` collects every remaining positional value into a string array (empty when none were passed).

```ts
static signature = "mail:send {user} {team?} {ids*}";
```

```shell
bunyad mail:send ada
bunyad mail:send ada billing 1 2 3
```

`argument("ids")` is `["1", "2", "3"]` in the second example. Names are strings. Cast them yourself when you need a number.

### Options

`{--queue}` is a boolean. It is `false` until the flag is present. `{--mode=}` takes a value, as `--mode=full` or as `--mode full`. `{--mode=operations}` takes a value and defaults to `operations`. `{Q|--queue}` also accepts the short flag `-Q`.

```ts
static signature = "mail:send {user} {--queue} {--mode=operations} {Q|--quiet}";
```

```shell
bunyad mail:send ada --queue --mode=full -Q
```

`option("queue")` is `true`. `option("mode")` is `"full"`. `option("quiet")` is `true`. A flag that is not in the signature is ignored by `option` and still appears in `tokens()`, which is the raw argument list after the command name. A `--` on its own ends flag parsing. Everything after it is positional, even when it starts with `-`.

Text after ` : ` inside a brace is discarded. Put the help line on `static description`.

## Command I/O

### Retrieving input

`argument` and `option` read the bound input. `tokens` returns the raw list:

```ts
const user = this.argument("user");
const queued = this.option("queue") === true;
const raw = this.tokens();
```

### Prompting

`ask` reads a line. `confirm` reads a yes or no answer and returns a boolean. The second argument is the default when the line is empty.

```ts
const name = await this.ask("Name");
const ok = await this.confirm("Send now?", true);
```

`password` and `select` live on `@bunyad/cli`. `password` does not echo the answer. `select` prints a numbered list and returns the chosen value.

```ts
import { password, select } from "@bunyad/cli";

const secret = await password("API key");
const role = await select("Role", ["admin", "editor"]);
```

### Writing output

`info`, `line`, and `comment` write to standard output. `warn` and `error` write to standard error. `newLine` prints blank lines. `line()` with no argument prints one blank line.

```ts
this.info("Mail queued.");
this.warn("No team was set.");
this.error("User was not found.");
this.newLine();
```

`table` from `@bunyad/cli` prints a header row and a separator:

```ts
import { table } from "@bunyad/cli";

table(
  ["Name", "Email"],
  [
    ["Ada", "ada@example.com"],
  ],
);
```

## Closure commands

Register a one-off command without a class file using `Console.command`:

```ts
import { Console } from "@bunyad/cli";

Console.command("mail:send {user}", async function () {
  this.info(`Sending to ${this.argument("user")}`);
});
```

Call this from a service provider `boot()` (or another boot-time module). The handler runs with `this` bound to a `Command` instance, so `argument`, `option`, `info`, and the other helpers work the same as on a class command.

## Running commands from code

`run` from `@bunyad/cli` executes a command the same way the `bunyad` binary does. The first array entry is the command name. The rest are arguments and options.

```ts
import { run } from "@bunyad/cli";

await run(["send:email", "ada", "--queue"]);
```

The process exit code is `process.exitCode` when `handle` returned a number.

## The shell

`bunyad console` boots the application, then reads JavaScript one line at a time. An expression is evaluated and printed. A statement (`const`, `let`, `if`, `for`, `await`, and the rest of that list) runs and is not printed.

Each line is a separate function. A `const` or `let` on one line is not visible on the next. Assign to `globalThis` when a later line needs the value:

```text
> globalThis.User = (await import("@/Models/User.ts")).default
> globalThis.User.find(1)
```

Exit with `.exit`, `exit`, `quit`, or Ctrl+D. The banner also lists `.exit` and Ctrl+D. Change application code, then start the shell again. It does not reload files on its own.

## The development server

`bunyad serve` loads `server.ts` with `BUNYAD_DEV=1`. `--hot` reloads the process through Bun's hot mode and also sets `BUNYAD_HOT=1`. `--watch` restarts the process when a file changes.

```shell
bunyad serve
bunyad serve --hot
bunyad serve --watch
```
