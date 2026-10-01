import { expect, test } from "bun:test";
import { Application } from "@bunyad/core";
import { json } from "@bunyad/http";
import { TestClient } from "../src/test-client.ts";
import { wrapResponse } from "../src/test-response.ts";

async function createApplication(): Promise<Application> {
  const app = new Application({ config: { app: { port: 0 } } });
  app.router.get("/", () => json({ ok: true }));
  app.router.get("/hello", () => json({ hello: "world" }));
  const echo = async (req: { method: string; loadJson: () => Promise<void>; input: (k: string) => unknown }) => {
    await req.loadJson();
    return json({ method: req.method, name: req.input("name") });
  };
  app.router.post("/echo", echo);
  app.router.put("/echo", echo);
  app.router.patch("/echo", echo);
  app.router.delete("/echo", async (req) => {
    await req.loadJson();
    return json({ method: req.method });
  });
  app.router.get("/auth-header", (req) =>
    json({ authorization: req.header("authorization") }),
  );
  await app.boot();
  return app;
}

test("TestResponse assertOk and status helpers", () => {
  wrapResponse(Response.json({ ok: true })).assertOk();
  wrapResponse(Response.json({ message: "Forbidden" }, { status: 403 })).assertForbidden();
  wrapResponse(new Response(null, { status: 201 })).assertCreated();
  wrapResponse(new Response(null, { status: 204 })).assertNoContent();
  wrapResponse(new Response(null, { status: 422 })).assertUnprocessable().assertClientError();
  wrapResponse(new Response(null, { status: 500 })).assertServerError();
  expect(() => wrapResponse(Response.json({}, { status: 500 })).assertOk()).toThrow(
    /Expected status 200/,
  );
});

test("TestResponse json is generic", async () => {
  const body = await wrapResponse(Response.json({ name: "Ada" })).json<{ name: string }>();
  expect(body.name).toBe("Ada");
});

test("TestResponse assertRedirect and headers", () => {
  const res = wrapResponse(
    new Response(null, {
      status: 302,
      headers: { Location: "/dashboard", "X-Request-Id": "abc" },
    }),
  );
  res.assertRedirect("/dashboard");
  res.assertRedirectContains("dash");
  res.assertLocation("/dashboard");
  res.assertHeader("X-Request-Id", "abc");
  res.assertHeaderContains("X-Request-Id", "ab");
  res.assertHeaderMissing("X-Missing");
});

test("TestResponse assertJson subset and exact", async () => {
  const res = wrapResponse(Response.json({ user: { id: 1, name: "Ada" }, ok: true }));
  await res.assertJson({ ok: true, user: { id: 1 } });
  await res.assertExactJson({ user: { id: 1, name: "Ada" }, ok: true });
  await res.assertJsonPath("user.name", "Ada");
  await res.assertJsonFragment({ name: "Ada" });
  await res.assertJsonMissing({ name: "Bob" });
  await res.assertJsonStructure({ user: { id: null, name: null }, ok: null });
  await res.assertJsonIsObject();
});

test("TestResponse assertSimilarJson and assertJsonCount", async () => {
  const res = wrapResponse(
    Response.json({ b: 2, a: 1, items: [{ id: 1 }, { id: 2 }] }),
  );
  await res.assertSimilarJson({ a: 1, b: 2, items: [{ id: 1 }, { id: 2 }] });
  await res.assertJsonCount("items", 2);
  await wrapResponse(Response.json([1, 2, 3])).assertJsonCount(3);
  await wrapResponse(Response.json([1, 2])).assertJsonIsArray();
});

test("TestResponse assertSee and assertDontSee", async () => {
  const res = wrapResponse(new Response("<h1>Hello Ada</h1>"));
  await res.assertSee("Ada");
  await res.assertDontSee("Bob");
  await res.assertContent("<h1>Hello Ada</h1>");
});

test("TestResponse tap/when/unless", async () => {
  let tapped = false;
  await wrapResponse(Response.json({ ok: true }))
    .assertOk()
    .tap(() => {
      tapped = true;
    });
  expect(tapped).toBe(true);
});

test("TestClient getJson/postJson/put/patch/delete and withToken", async () => {
  const client = await TestClient.create({ createApplication });

  await (await client.getJson("/hello")).assertOk().assertJson({ hello: "world" });

  await (
    await client.postJson("/echo", { name: "Ada" })
  )
    .assertOk()
    .assertJson({ method: "POST", name: "Ada" });

  await (
    await client.putJson("/echo", { name: "Bob" })
  )
    .assertOk()
    .assertJson({ method: "PUT", name: "Bob" });

  await (
    await client.patch("/echo", { name: "Pat" })
  )
    .assertOk()
    .assertJson({ method: "PATCH", name: "Pat" });

  await (await client.deleteJson("/echo")).assertOk().assertJson({ method: "DELETE" });

  client.withToken("secret-token");
  await (
    await client.getJson("/auth-header")
  ).assertJson({ authorization: "Bearer secret-token" });
  client.withoutToken();
  await (await client.getJson("/auth-header")).assertJson({ authorization: null });
});

test("TestClient actingAs requires session cookie", async () => {
  const client = await TestClient.create({ createApplication });
  await expect(
    client.actingAs({ id: 1 }),
  ).rejects.toThrow(/actingAs\(\) requires an active session cookie/);
});
