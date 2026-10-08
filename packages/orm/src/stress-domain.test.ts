/**
 * Realistic domain stress test, run on every available database:
 *
 *   Org ─┬─ Team ── (members pivot) ── User
 *        └─ Project ── Task
 *   User ── Order ── Item, Payment
 *   Comment ── commentable (Project | Task | Order)   [morphTo]
 *   User ── roles (morphToMany)
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model, clearMorphMap, morphMap } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();
const N = Number(Bun.env.STRESS_ROWS ?? 2000);

class SOrg extends Model {
  static table = "s_orgs";
  static fillable = ["name"];
  declare id: number;
  declare name: string;
  teams() { return this.hasMany(STeam, "org_id"); }
  projects() { return this.hasMany(SProject, "org_id"); }
  tasks() { return this.hasManyThrough(STask, SProject, "org_id", "project_id"); }
}
class STeam extends Model {
  static table = "s_teams";
  static fillable = ["org_id", "name"];
  declare id: number;
  declare name: string;
  org() { return this.belongsTo(SOrg, "org_id"); }
  members() { return this.belongsToMany(SUser, "s_team_user", "team_id", "user_id").withPivot("role").withTimestamps(); }
}
class SUser extends Model {
  static table = "s_users";
  static fillable = ["name", "email", "balance"];
  static softDeletes = true;
  declare id: number;
  declare name: string;
  declare balance: number;
  teams() { return this.belongsToMany(STeam, "s_team_user", "user_id", "team_id").withPivot("role"); }
  orders() { return this.hasMany(SOrder, "user_id"); }
  roles() { return this.morphToMany(SRole, "model", { table: "s_model_roles", foreignPivotKey: "model_id", relatedPivotKey: "role_id", morphTypes: ["user"] }); }
}
class SRole extends Model {
  declare name: string;
  static table = "s_roles";
  static fillable = ["name"];
  declare id: number;
}
class SProject extends Model {
  static table = "s_projects";
  static fillable = ["org_id", "name", "status"];
  declare id: number;
  org() { return this.belongsTo(SOrg, "org_id"); }
  tasks() { return this.hasMany(STask, "project_id"); }
  comments() { return this.morphMany(SComment, "commentable"); }
}
class STask extends Model {
  static table = "s_tasks";
  static fillable = ["project_id", "title", "done", "points"];
  declare id: number;
  project() { return this.belongsTo(SProject, "project_id"); }
  comments() { return this.morphMany(SComment, "commentable"); }
}
class SOrder extends Model {
  declare user_id: number;
  static table = "s_orders";
  static fillable = ["user_id", "total", "status"];
  declare id: number;
  declare total: number;
  user() { return this.belongsTo(SUser, "user_id"); }
  items() { return this.hasMany(SItem, "order_id"); }
  payments() { return this.hasMany(SPayment, "order_id"); }
  comments() { return this.morphMany(SComment, "commentable"); }
}
class SItem extends Model {
  static table = "s_items";
  static fillable = ["order_id", "sku", "qty", "price"];
  declare id: number;
}
class SPayment extends Model {
  declare status: string;
  static table = "s_payments";
  static fillable = ["order_id", "amount", "status"];
  declare id: number;
}
class SComment extends Model {
  static table = "s_comments";
  static fillable = ["body", "commentable_type", "commentable_id"];
  declare id: number;
  commentable() { return this.morphTo("commentable"); }
}

const tables = [
  "s_model_roles", "s_comments", "s_payments", "s_items", "s_orders", "s_tasks",
  "s_projects", "s_team_user", "s_teams", "s_roles", "s_users", "s_orgs",
];
const num = (v: unknown) => Number(v);

describe.each(drivers.map((d) => [d.name, d] as const))(
  "domain stress (%s)",
  (_name, driver) => {
    const c = driver.connection;

    async function bulk(table: string, columns: string[], rows: unknown[][]) {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        await c.run(
          `INSERT INTO ${table} (${columns.join(",")}) VALUES ${chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",")}`,
          chunk.flat(),
        );
      }
    }

    beforeAll(async () => {
      Model.setConnection(c);
      morphMap({ project: SProject, task: STask, order: SOrder, user: SUser });
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("s_orgs", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("s_users", (b) => {
        b.id(); b.string("name"); b.string("email").nullable(); b.integer("balance").nullable();
        b.timestamps(); b.softDeletes();
      });
      await schema.create("s_roles", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("s_teams", (b) => { b.id(); b.integer("org_id"); b.string("name"); b.timestamps(); });
      await schema.create("s_team_user", (b) => {
        b.integer("team_id"); b.integer("user_id"); b.string("role").nullable();
        b.timestamp("created_at").nullable(); b.timestamp("updated_at").nullable();
      });
      await schema.create("s_projects", (b) => {
        b.id(); b.integer("org_id"); b.string("name"); b.string("status"); b.timestamps();
      });
      await schema.create("s_tasks", (b) => {
        b.id(); b.integer("project_id"); b.string("title"); b.integer("done"); b.integer("points"); b.timestamps();
      });
      await schema.create("s_orders", (b) => {
        b.id(); b.integer("user_id"); b.integer("total"); b.string("status"); b.timestamps();
      });
      await schema.create("s_items", (b) => {
        b.id(); b.integer("order_id"); b.string("sku"); b.integer("qty"); b.integer("price");
      });
      await schema.create("s_payments", (b) => {
        b.id(); b.integer("order_id"); b.integer("amount"); b.string("status");
      });
      await schema.create("s_comments", (b) => {
        b.id(); b.string("body"); b.string("commentable_type"); b.integer("commentable_id"); b.timestamps();
      });
      await schema.create("s_model_roles", (b) => {
        b.integer("role_id"); b.string("model_type"); b.integer("model_id");
      });
      for (const [t, col] of [
        ["s_teams", "org_id"], ["s_team_user", "team_id"], ["s_team_user", "user_id"],
        ["s_projects", "org_id"], ["s_tasks", "project_id"], ["s_orders", "user_id"],
        ["s_items", "order_id"], ["s_payments", "order_id"], ["s_comments", "commentable_id"],
      ] as const) {
        await c.run(`CREATE INDEX ix_${t}_${col} ON ${t}(${col})`);
      }

      const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
      const orgs = 5, teamsPer = 4, projectsPer = 10, tasksPer = Math.max(5, Math.floor(N / 50));
      await bulk("s_orgs", ["name", "created_at", "updated_at"], Array.from({ length: orgs }, (_, i) => [`org${i + 1}`, ts, ts]));
      await bulk("s_roles", ["name", "created_at", "updated_at"], [["admin", ts, ts], ["editor", ts, ts], ["viewer", ts, ts]]);
      await bulk("s_users", ["name", "email", "balance", "created_at", "updated_at"],
        Array.from({ length: N }, (_, i) => [`user${i + 1}`, `u${i + 1}@x.test`, 1000, ts, ts]));
      await bulk("s_teams", ["org_id", "name", "created_at", "updated_at"],
        Array.from({ length: orgs * teamsPer }, (_, i) => [(i % orgs) + 1, `team${i + 1}`, ts, ts]));
      await bulk("s_team_user", ["team_id", "user_id", "role"],
        Array.from({ length: N * 2 }, (_, i) => [(i % (orgs * teamsPer)) + 1, (i % N) + 1, i % 7 === 0 ? "lead" : "member"]));
      await bulk("s_projects", ["org_id", "name", "status", "created_at", "updated_at"],
        Array.from({ length: orgs * projectsPer }, (_, i) => [(i % orgs) + 1, `proj${i + 1}`, i % 4 === 0 ? "archived" : "active", ts, ts]));
      await bulk("s_tasks", ["project_id", "title", "done", "points", "created_at", "updated_at"],
        Array.from({ length: orgs * projectsPer * tasksPer }, (_, i) => [(i % (orgs * projectsPer)) + 1, `task${i + 1}`, i % 3 === 0 ? 1 : 0, (i % 8) + 1, ts, ts]));
      await bulk("s_orders", ["user_id", "total", "status", "created_at", "updated_at"],
        Array.from({ length: N }, (_, i) => [(i % N) + 1, 0, i % 5 === 0 ? "cancelled" : "open", ts, ts]));
      await bulk("s_items", ["order_id", "sku", "qty", "price"],
        Array.from({ length: N * 3 }, (_, i) => [(i % N) + 1, `sku${i % 50}`, (i % 4) + 1, 10]));
      await bulk("s_payments", ["order_id", "amount", "status"],
        Array.from({ length: N }, (_, i) => [i + 1, 30, i % 7 === 0 ? "failed" : "paid"]));
      const kinds = ["project", "task", "order"];
      await bulk("s_comments", ["body", "commentable_type", "commentable_id", "created_at", "updated_at"],
        Array.from({ length: N }, (_, i) => [`c${i}`, kinds[i % 3]!, (i % 10) + 1, ts, ts]));
      await bulk("s_model_roles", ["role_id", "model_type", "model_id"],
        Array.from({ length: Math.min(N, 500) }, (_, i) => [(i % 3) + 1, "user", i + 1]));
    }, 120_000);

    afterAll(async () => {
      clearMorphMap();
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
    });

    test("nested eager loading with constraints returns the right rows, in few queries", async () => {
      const orgs = await SOrg.with({
        projects: (q: any) => q.where("status", "active").orderBy("id"),
        "projects.tasks": (q: any) => q.where("done", 0).orderBy("id").limit(1000),
      }).orderBy("id").get();
      expect(orgs.count()).toBe(5);
      for (const org of orgs.all() as any[]) {
        expect(org.projects.all().every((p: any) => p.status === "active")).toBe(true);
        for (const p of org.projects.all()) {
          expect(p.tasks.all().every((t: any) => num(t.done) === 0)).toBe(true);
        }
      }
    });

    test("no N+1: preventLazyLoading survives a deep eager load", async () => {
      Model.preventLazyLoading(true);
      try {
        const teams = await STeam.with("org", "members").limit(20).get();
        for (const t of teams.all() as any[]) {
          expect(t.org.name).toBeTruthy();
          expect(t.members.count()).toBeGreaterThan(0);
        }
      } finally {
        Model.preventLazyLoading(false);
      }
    });

    test("belongsToMany pivot data round-trips through eager loading", async () => {
      const team = (await STeam.with("members").where("name", "team1").first()) as any;
      const roles = new Set(team.members.all().map((m: any) => m.pivot?.role));
      expect([...roles].sort()).toEqual(["lead", "member"]);
    });

    test("polymorphic: morphTo eager load across three target types", async () => {
      const comments = await SComment.with("commentable").limit(300).get();
      const counts: Record<string, number> = {};
      for (const cm of comments.all() as any[]) {
        expect(cm.commentable).not.toBeNull();
        counts[cm.commentable.constructor.name] = (counts[cm.commentable.constructor.name] ?? 0) + 1;
      }
      expect(Object.keys(counts).sort()).toEqual(["SOrder", "SProject", "STask"]);
    });

    test("polymorphic: morphMany counts do not mix types that share ids", async () => {
      const proj = await SProject.withCount("comments").orderBy("id").limit(10).get();
      const expected = await c.all<{ n: number }>(
        "SELECT commentable_id AS id, COUNT(*) AS n FROM s_comments WHERE commentable_type = 'project' GROUP BY commentable_id",
      );
      const byId = new Map(expected.map((r: any) => [Number(r.id), Number(r.n)]));
      for (const p of proj.all() as any[]) {
        expect(num(p.comments_count)).toBe(byId.get(p.id) ?? 0);
      }
    });

    test("hasManyThrough aggregates equal a hand-written join", async () => {
      const orgs = await SOrg.withCount("tasks").withSum("tasks", "points").orderBy("id").get();
      const [row] = await c.all<{ n: number; s: number }>(
        "SELECT COUNT(*) AS n, SUM(t.points) AS s FROM s_tasks t JOIN s_projects p ON p.id = t.project_id WHERE p.org_id = 1",
      );
      const org1 = orgs.first() as any;
      expect(num(org1.tasks_count)).toBe(num(row!.n));
      expect(num(org1.tasks_sum_points)).toBe(num(row!.s));
    });

    test("conditional aggregates match SQL (paid vs failed, per order)", async () => {
      const orders = await SOrder.withSum({ "payments as paid_total": (q: any) => q.where("status", "paid") }, "amount")
        .withCount({ "payments as failed_count": (q: any) => q.where("status", "failed") })
        .whereIn("id", [1, 2, 8])
        .orderBy("id")
        .get();
      const [o1, o2, o8] = orders.all() as any[];
      expect(num(o1.failed_count)).toBe(1);
      expect(num(o1.paid_total || 0)).toBe(0);
      expect(num(o2.paid_total)).toBe(30);
      expect(num(o8.failed_count)).toBe(1); // i=7
    });

    test("whereHas / doesntHave agree with SQL counts", async () => {
      const withFailed = await SOrder.whereHas("payments", (q: any) => q.where("status", "failed")).count();
      const [r] = await c.all<{ n: number }>("SELECT COUNT(DISTINCT order_id) AS n FROM s_payments WHERE status = 'failed'");
      expect(withFailed).toBe(num(r!.n));
      const without = await SOrder.doesntHave("payments").count();
      expect(without).toBe(0);
    });

    test("soft deletes hide users from relations, aggregates and eager loads", async () => {
      const victim = (await SUser.find(1)) as any;
      await victim.delete();
      expect(await SUser.where("id", 1).count()).toBe(0);
      expect(await SUser.withTrashed().where("id", 1).count()).toBe(1);
      const orders = await SOrder.with("user").where("user_id", 1).get();
      expect(orders.count()).toBeGreaterThan(0);
      expect((orders.first() as any).user).toBeNull();
      await ((await SUser.withTrashed().where("id", 1).first()) as any).restore();
      expect(await SUser.where("id", 1).count()).toBe(1);
    });

    test("transactions: nested savepoint rollback keeps the outer work", async () => {
      const before = await SOrg.count();
      await c.transaction(async () => {
        await SOrg.create({ name: "tx-outer" });
        await expect(
          c.transaction(async () => {
            await SOrg.create({ name: "tx-inner" });
            throw new Error("inner fails");
          }),
        ).rejects.toThrow("inner fails");
      });
      expect(await SOrg.count()).toBe(before + 1);
      expect(await SOrg.where("name", "tx-inner").count()).toBe(0);
      expect(await SOrg.where("name", "tx-outer").count()).toBe(1);
    });

    test("transactions: failure rolls everything back (money transfer)", async () => {
      const [a, b] = [(await SUser.find(2)) as any, (await SUser.find(3)) as any];
      await expect(
        c.transaction(async () => {
          a.balance -= 100;
          await a.save();
          b.balance += 100;
          await b.save();
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(num((await SUser.find(2) as any).balance)).toBe(1000);
      expect(num((await SUser.find(3) as any).balance)).toBe(1000);
    });

    test("concurrent atomic increments from many workers are not lost", async () => {
      await Promise.all(Array.from({ length: 25 }, () => (SUser.where("id", 4) as any).increment("balance", 10)));
      expect(num((await SUser.find(4) as any).balance)).toBe(1000 + 25 * 10);
    });

    test("pagination: offset and cursor walk the same rows exactly once", async () => {
      const seen = new Set<number>();
      let page = 1;
      for (;;) {
        const p: any = await SOrder.orderBy("id").paginate(300, page);
        for (const o of p.items) seen.add(o.id);
        if (page >= p.lastPage()) break;
        page++;
      }
      expect(seen.size).toBe(N);

      const cursorSeen = new Set<number>();
      let cursor: string | null = null;
      for (let guard = 0; guard < 100; guard++) {
        const p: any = await SOrder.orderBy("id").cursorPaginate(400, cursor);
        for (const o of p.items) cursorSeen.add(o.id);
        cursor = p.nextCursor();
        if (!cursor) break;
      }
      expect(cursorSeen.size).toBe(N);
    });

    test("chunkById visits every row once even while rows are deleted behind it", async () => {
      const visited: number[] = [];
      await SItem.query().chunkById(250, async (rows: any) => {
        for (const r of rows.all()) visited.push(r.id);
        await c.run("DELETE FROM s_items WHERE id <= ?", [rows.all().at(-1).id - 100]);
      });
      expect(new Set(visited).size).toBe(visited.length);
      expect(visited.length).toBe(N * 3);
    });

    test("bulk: upsert, mass update and mass delete report correct counts", async () => {
      await // Explicit high id: Postgres does not advance the sequence for explicit ids (same as Laravel).
      await SRole.upsert([{ id: 1, name: "admin2" }, { id: 1000, name: "auditor" }], ["id"], ["name"]);
      expect((await SRole.find(1) as any).name).toBe("admin2");
      expect((await SRole.find(1000) as any).name).toBe("auditor");
      expect(await SRole.count()).toBe(4);
      const updated = await SPayment.where("status", "failed").update({ status: "refunded" });
      expect(updated).toBe(await SPayment.where("status", "refunded").count());
      const deleted = await SPayment.where("status", "refunded").delete();
      expect(deleted).toBe(updated);
    });

    test("large hydration: every row of a big table loads with correct shape", async () => {
      const all = await SItem.query().get();
      expect(all.count()).toBeLessThanOrEqual(N * 3);
      const first = all.first() as any;
      expect(typeof first.sku).toBe("string");
    });

    test("read-modify-write under lockForUpdate does not lose updates (concurrent transactions)", async () => {
      const workers = 12;
      await Promise.all(
        Array.from({ length: workers }, () =>
          c.transaction(async () => {
            const u = (await SUser.where("id", 5).lockForUpdate().first()) as any;
            u.balance = num(u.balance) + 10;
            await u.save();
          }),
        ),
      );
      expect(num((await SUser.find(5) as any).balance)).toBe(1000 + workers * 10);
    });

    test("deep eager load over every user matches SQL counts (chunked IN lists)", async () => {
      const users = await SUser.with("orders.items", "teams").get();
      expect(users.count()).toBe(N);
      let items = 0;
      let memberships = 0;
      for (const u of users.all() as any[]) {
        for (const o of u.orders.all()) items += o.items.count();
        memberships += u.teams.count();
      }
      const [i] = await c.all<{ n: number }>("SELECT COUNT(*) AS n FROM s_items");
      const [m] = await c.all<{ n: number }>("SELECT COUNT(*) AS n FROM s_team_user");
      expect(items).toBe(num(i!.n));
      expect(memberships).toBe(num(m!.n));
    });

    test("morphTo to a soft-deleted target loads as null, other targets still load", async () => {
      const cm = (await SComment.create({ body: "on user", commentable_type: "user", commentable_id: 7 })) as any;
      const user = (await SUser.find(7)) as any;
      await user.delete();
      const loaded = (await SComment.with("commentable").find(cm.id)) as any;
      expect(loaded.commentable).toBeNull();
      await ((await SUser.withTrashed().where("id", 7).first()) as any).restore();
      const again = (await SComment.with("commentable").find(cm.id)) as any;
      expect(again.commentable?.id).toBe(7);
    });

    test("large pivot sync touches only the difference and keeps pivot data", async () => {
      const team = (await STeam.create({ org_id: 1, name: "big" })) as any;
      const ids = Array.from({ length: 500 }, (_, i) => i + 1);
      await team.members().attach(ids, { role: "member" });
      await team.members().updateExistingPivot(1, { role: "lead" });
      const target = [...ids.slice(10), 501, 502];
      const res = await team.members().sync(target);
      expect(res.detached.length).toBe(10);
      expect(res.attached.map(Number).sort((a: number, b: number) => a - b)).toEqual([501, 502]);
      const rows = await c.all<{ n: number }>("SELECT COUNT(*) AS n FROM s_team_user WHERE team_id = ?", [team.id]);
      expect(num(rows[0]!.n)).toBe(target.length);
      const kept = await c.all<{ role: string }>("SELECT role FROM s_team_user WHERE team_id = ? AND user_id = 11", [team.id]);
      expect(kept[0]!.role).toBe("member");
    });

    test("firstOrCreate / updateOrCreate are idempotent and return the same row", async () => {
      const a = (await SRole.firstOrCreate({ name: "ops" })) as any;
      const b = (await SRole.firstOrCreate({ name: "ops" })) as any;
      expect(a.id).toBe(b.id);
      const u1 = (await SRole.updateOrCreate({ name: "ops" }, { name: "ops" })) as any;
      expect(u1.id).toBe(a.id);
      expect(await SRole.where("name", "ops").count()).toBe(1);
    });

    test("roles via morphToMany: sync, whereHas and eager loading agree", async () => {
      const user = (await SUser.find(10)) as any;
      await user.roles().sync([1, 2]);
      expect((await user.roles().get()).pluck("name").all().sort()).toEqual(["admin2", "editor"]);
      const withEditor = await SUser.whereHas("roles", (q: any) => q.where("name", "editor")).whereIn("id", [10, 11]).get();
      expect(withEditor.pluck("id").all()).toContain(10);
      const loaded = (await SUser.with("roles").find(10)) as any;
      expect(loaded.roles.count()).toBe(2);
    });
  },
);
