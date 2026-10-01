---
title: Console Tests
description: Drive interactive prompts with Prompt.fake and run commands from tests.
---

# Console Tests

## Introduction

Console commands are ordinary TypeScript classes. In tests you can invoke them with `TestCase.command(...)` (fluent exit-code / output asserts) or with `run` from `@bunyad/cli` (same entry the `bunyad` binary uses). Feed interactive answers with `Prompt.fake`.

## Running a command

```ts
import { TestCase } from "@bunyad/testing";

const case_ = new TestCase();
await case_
  .command("inspire")
  .expectsOutput("...")
  .assertSuccessful();
```

Or call `run` directly:

```ts
import { run } from "@bunyad/cli";

await run(["inspire"]);
await run(["send:email", "ada", "--queue"]);
```

Boot providers the same way the CLI does — call `createApplication()` first when the command needs the container, database, or config.

## Faking prompts

`Prompt.fake(answers)` queues return values for `text`, `confirm`, `select`, `multiselect`, `password`, and the other prompt helpers. Call it before the command runs:

```ts
import { Prompt, run } from "@bunyad/cli";

Prompt.fake(["Ada", true, "owner"]);

await run(["user:create"]);

Prompt.assertAsked("text", "Name");
Prompt.assertAsked("confirm");
Prompt.restore();
```

`Prompt.fake()` with an empty array (or after answers are exhausted) fails closed — interactive prompts throw instead of hanging the test process.

Helpers:

```ts
Prompt.assertAsked("text", "What is your name?");
Prompt.assertNotAsked("password");
Prompt.restore(); // back to interactive mode
```

Override printed lines with `Prompt.setOutput((line) => { … })` when you need to capture `this.info` / `this.line` style output written through the prompt writer.

`TestCase.command` also supports `expectsQuestion` / `expectsOutput` before assert helpers:

```ts
await case_
  .command("greet")
  .expectsQuestion("Name", "Ada")
  .expectsOutput("Hello, Ada")
  .assertSuccessful();
```

## Example

```ts
import { expect, test } from "bun:test";
import { Prompt, run } from "@bunyad/cli";
import { createApplication } from "../bootstrap/app.ts";

test("greet command uses the given name", async () => {
  await createApplication();
  Prompt.fake(["Ada"]);

  await run(["greet"]);

  Prompt.assertAsked("text");
  Prompt.restore();
});
```

See [Console](/docs/1.x/console) for writing commands and the prompt API surface.
