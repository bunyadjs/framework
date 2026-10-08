/**
 * Bunyad-only ORM micro-benchmarks (no Prisma/Drizzle install needed).
 *
 *   bun benchmarks/orm/internal.ts
 *   ROWS=20000 ITERATIONS=15 LEGS=sync,attach bun benchmarks/orm/internal.ts
 *
 * Runs on SQLite in memory; set BUNYAD_TEST_POSTGRES_URL / BUNYAD_TEST_MYSQL_URL
 * to also run the same legs on those servers.
 */
import { connectMysql, connectPostgres, connectSqlite, schemaFor, type Connection } from "../../packages/database/src/index.ts";
import { Model } from "../../packages/orm/src/index.ts";

const ROWS = Number(Bun.env.ROWS ?? 10_000);
const ITERATIONS = Number(Bun.env.ITERATIONS ?? 10);
const WARMUP = Number(Bun.env.WARMUP ?? 2);
const LEGS = Bun.env.LEGS?.split(",");

class Author extends Model {
  static table = "b_authors";
  static fillable = ["name"];
  declare id: number;
  posts() {
    return this.hasMany(Post, "author_id");
  }
}
class Post extends Model {
  static table = "b_posts";
  static fillable = ["author_id", "title", "views", "status"];
  declare id: number;
  author() {
    return this.belongsTo(Author, "author_id");
  }
  tags() {
    return this.belongsToMany(Tag, "b_post_tag", "post_id", "tag_id");
  }
}
class Tag extends Model {
  static table = "b_tags";
  static fillable = ["name"];
  declare id: number;
}

async function setup(conn: Connection) {
  Model.setConnection(conn);
  const schema = schemaFor(conn);
  for (const t of ["b_post_tag", "b_posts", "b_tags", "b_authors"]) await schema.dropIfExists(t);
  await schema.create("b_authors", (b) => { b.id(); b.string("name"); b.timestamps(); });
  await schema.create("b_posts", (b) => {
    b.id();
    b.integer("author_id");
    b.string("title");
    b.integer("views");
    b.string("status");
    b.timestamps();
  });
  await schema.create("b_tags", (b) => { b.id(); b.string("name"); b.timestamps(); });
  await schema.create("b_post_tag", (b) => { b.integer("post_id"); b.integer("tag_id"); });

  const authors = Math.max(10, Math.floor(ROWS / 20));
  const now = new Date().toISOString();
  for (let i = 0; i < authors; i += 500) {
    const rows = Array.from({ length: Math.min(500, authors - i) }, (_, k) => ({
      name: `a${i + k}`, created_at: now, updated_at: now,
    }));
    await conn.run(
      `INSERT INTO b_authors (name, created_at, updated_at) VALUES ${rows.map(() => "(?,?,?)").join(",")}`,
      rows.flatMap((r) => [r.name, r.created_at, r.updated_at]),
    );
  }
  for (let i = 0; i < ROWS; i += 300) {
    const rows = Array.from({ length: Math.min(300, ROWS - i) }, (_, k) => [
      ((i + k) % authors) + 1, `post ${i + k}`, (i + k) % 1000, (i + k) % 3 === 0 ? "draft" : "live", now, now,
    ]);
    await conn.run(
      `INSERT INTO b_posts (author_id, title, views, status, created_at, updated_at) VALUES ${rows.map(() => "(?,?,?,?,?,?)").join(",")}`,
      rows.flat(),
    );
  }
  for (let i = 0; i < 200; i++) {
    await conn.run("INSERT INTO b_tags (name, created_at, updated_at) VALUES (?,?,?)", [`t${i}`, now, now]);
  }
  for (let i = 0; i < ROWS; i += 300) {
    const rows = Array.from({ length: Math.min(300, ROWS - i) }, (_, k) => [i + k + 1, ((i + k) % 200) + 1]);
    await conn.run(
      `INSERT INTO b_post_tag (post_id, tag_id) VALUES ${rows.map(() => "(?,?)").join(",")}`,
      rows.flat(),
    );
  }
  // Foreign keys are indexed on every driver (a real schema would be).
  await conn.run("CREATE INDEX b_posts_author ON b_posts(author_id)");
  await conn.run("CREATE INDEX b_pt_post ON b_post_tag(post_id)");
  await conn.run("CREATE INDEX b_pt_tag ON b_post_tag(tag_id)");
}

type Leg = { name: string; run: () => Promise<unknown> };

const legs: Leg[] = [
  { name: "find-by-id", run: async () => Post.find(1 + Math.floor(Math.random() * ROWS)) },
  { name: "hydrate-all", run: async () => Post.query().get() },
  { name: "hydrate-all-rows", run: async () => Post.query().rows().get() },
  { name: "where-limit-100", run: async () => Post.where("status", "live").orderBy("id").limit(100).get() },
  { name: "paginate", run: async () => Post.paginate(50, 3) },
  { name: "cursor-chunk", run: async () => {
    let n = 0;
    await Post.query().chunkById(1000, (rows: { count(): number }) => { n += rows.count(); });
    return n;
  } },
  { name: "eager-belongsTo", run: async () => Post.with("author").limit(2000).get() },
  { name: "eager-hasMany", run: async () => Author.with("posts").limit(200).get() },
  { name: "eager-belongsToMany", run: async () => Post.with("tags").limit(2000).get() },
  { name: "eager-nested", run: async () => Author.with("posts.tags").limit(50).get() },
  { name: "withCount", run: async () => Author.withCount("posts").limit(500).get() },
  { name: "withSum-constrained", run: async () => Author.withSum({ "posts as live_views": (q) => q.where("status", "live") }, "views").limit(500).get() },
  { name: "whereHas", run: async () => Author.whereHas("posts", (q) => q.where("views", ">", 900)).limit(500).get() },
  { name: "insert-one", run: async () => Tag.create({ name: "x" }) },
  { name: "update-one", run: async () => {
    const p = (await Post.find(1)) as Post;
    p.views = Math.floor(Math.random() * 1e6);
    await p.save();
  } },
  { name: "attach-1000", run: async () => {
    const p = (await Post.create({ author_id: 1, title: "n", views: 0, status: "live" })) as Post;
    await p.tags().attach(Array.from({ length: 1000 }, (_, i) => (i % 200) + 1 + i * 0));
    await p.tags().detach();
    await p.delete();
  } },
  { name: "sync-200-of-200", run: async () => {
    const p = (await Post.find(1)) as Post;
    await p.tags().sync(Array.from({ length: 200 }, (_, i) => i + 1));
  } },
  { name: "delete-where", run: async () => { await Tag.where("name", "x").delete(); } },
];

function pct(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

async function runDriver(name: string, conn: Connection) {
  console.log(`\n== ${name} (rows=${ROWS}, iterations=${ITERATIONS}) ==`);
  await setup(conn);
  console.log("leg".padEnd(26), "median ms".padStart(10), "p95 ms".padStart(10), "min ms".padStart(10));
  for (const leg of legs) {
    if (LEGS && !LEGS.includes(leg.name)) continue;
    for (let i = 0; i < WARMUP; i++) await leg.run();
    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t = performance.now();
      await leg.run();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    console.log(
      leg.name.padEnd(26),
      pct(times, 0.5).toFixed(2).padStart(10),
      pct(times, 0.95).toFixed(2).padStart(10),
      times[0]!.toFixed(2).padStart(10),
    );
  }
}

await runDriver("sqlite", connectSqlite());
const pg = Bun.env.BUNYAD_TEST_POSTGRES_URL;
if (pg) await runDriver("postgres", connectPostgres({ url: pg, max: 4 }));
const my = Bun.env.BUNYAD_TEST_MYSQL_URL;
if (my) await runDriver("mysql", connectMysql({ url: my } as never));
process.exit(0);
