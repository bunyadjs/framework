/**
 * `bun run dev` — the app server with hot reload, the frontend bundle
 * rebuilding as `resources/js` changes, typed routes and props regenerating
 * as routes, pages, and shared props change, and Tailwind rebuilding
 * `public/build/app.css`. Each line is prefixed with the process it came from.
 * Ctrl+C, or any process exiting, stops them all.
 */
// A module, so the top-level `await` at the end is allowed.
export {};

type Task = { name: string; color: string; cmd: string[]; quiet?: RegExp };

const tasks: Task[] = [
  { name: "server", color: "\x1b[34m", cmd: ["bun", "./bunyad", "serve", "--hot"] },
  { name: "js", color: "\x1b[33m", cmd: ["bun", "scripts/build.ts", "--watch"] },
  // Typed routes, shared props, and page props follow the code (`bunyad types:generate`).
  { name: "types", color: "\x1b[36m", cmd: ["bun", "./bunyad", "types:generate", "--watch"] },
  {
    name: "css",
    color: "\x1b[35m",
    cmd: ["bunx", "tailwindcss", "-i", "resources/css/app.css", "-o", "public/build/app.css", "--watch=always"],
    // Tailwind prints a banner and "Done in 5ms" on every rebuild.
    quiet: /^(≈ tailwindcss|\/\*! 🌼 daisyUI|Done in)/,
  },
];

const width = Math.max(...tasks.map((task) => task.name.length));
const prefix = (task: Task) =>
  `${task.color}[${task.name}]\x1b[0m${" ".repeat(width - task.name.length)} `;

async function pipe(task: Task, stream: ReadableStream<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      const plain = Bun.stripANSI(line).trim();
      if (plain === "" || task.quiet?.test(plain)) continue;
      process.stdout.write(`${prefix(task)}${line}\n`);
    }
  }
}

const children = tasks.map((task) => {
  const child = Bun.spawn(task.cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  void pipe(task, child.stdout);
  void pipe(task, child.stderr);
  return child;
});
process.stdout.write(`${prefix(tasks.find((task) => task.name === "css")!)}watching resources/js → public/build/app.css\n`);

// Stop children and wait for them to exit, so the server (a grandchild via
// `bunyad serve`) has released its port before this process goes away.
let stopping = false;
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  await Promise.race([
    Promise.all(children.map((child) => child.exited)),
    Bun.sleep(3000),
  ]);
  for (const child of children) child.kill("SIGKILL");
  process.exit(code);
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => void stop());
}

await stop(await Promise.race(children.map((child) => child.exited)));
