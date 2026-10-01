import { expect, test } from "bun:test";
import { Command, Description, Signature } from "./command.ts";
import { bindSignatureInput, parseSignature } from "./signature.ts";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAppCommandHandlers, runAppCommands } from "./app-commands.ts";

test("parseSignature reads name arguments and options", () => {
  const parsed = parseSignature(
    "mail:send {user} {--queue} {--mode=operations}",
  );
  expect(parsed.name).toBe("mail:send");
  expect(parsed.arguments.map((a) => a.name)).toEqual(["user"]);
  expect(parsed.options.map((o) => o.name)).toEqual(["queue", "mode"]);
  expect(parsed.options[0]?.acceptsValue).toBe(false);
  expect(parsed.options[1]?.acceptsValue).toBe(true);
  expect(parsed.options[1]?.default).toBe("operations");
});

test("bindSignatureInput keeps whereNull-style or flags in order", () => {
  const parsed = parseSignature(
    "tenant:clean {tenant?} {--force} {--mode=operations}",
  );
  const bound = bindSignatureInput(parsed, [
    "store-21",
    "--force",
    "--mode",
    "full",
  ]);
  expect(bound.arguments.tenant).toBe("store-21");
  expect(bound.options.force).toBe(true);
  expect(bound.options.mode).toBe("full");
});

test("Command argument and option helpers", () => {
  class PingCommand extends Command {
    static signature = "ping {host} {--fast}";
    async handle() {
      return 0;
    }
  }
  const command = new PingCommand();
  command.bindInput(["example.test", "--fast"]);
  expect(command.argument("host")).toBe("example.test");
  expect(command.option("fast")).toBe(true);
  expect(command.tokens()).toEqual(["example.test", "--fast"]);
});

test("Signature and Description decorators set static metadata", () => {
  @Signature("mail:send {user}")
  @Description("Send a marketing email")
  class MailSendCommand extends Command {
    async handle() {
      return 0;
    }
  }
  expect(MailSendCommand.signature).toBe("mail:send {user}");
  expect(MailSendCommand.description).toBe("Send a marketing email");
  const command = new MailSendCommand();
  command.bindInput(["ada"]);
  expect(command.argument("user")).toBe("ada");
});

test("loadAppCommandHandlers discovers Command subclasses", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-console-"));
  const dir = join(root, "app/Console/Commands");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "PingCommand.ts"),
    `import { Command } from ${JSON.stringify(new URL("./command.ts", import.meta.url).pathname)};
export default class PingCommand extends Command {
  static signature = "ping";
  static description = "Pong";
  async handle() {
    console.log("pong");
    return 0;
  }
}
`,
  );

  const handlers = await loadAppCommandHandlers(root);
  expect(Object.keys(handlers)).toEqual(["ping"]);
  const code = await runAppCommands(["ping"], root);
  expect(code).toBe(0);
});
