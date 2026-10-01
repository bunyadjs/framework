import express from "express";
import { close, getConnection } from "./db.ts";
import { bootstrap } from "./bootstrap.ts";
import { usersRouter } from "./routes/users.ts";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use(usersRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    res.status(500).json({ error: message });
  },
);

await bootstrap();
getConnection();

const server = app.listen(port, () => {
  console.log(`orm-node-express listening on http://127.0.0.1:${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down…`);
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
