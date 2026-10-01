import { expect, test } from "bun:test";
import { ConfigRepository, config, Config, setConfigInstance } from "../src/index.ts";

test("get and set nested keys", () => {
  const c = new ConfigRepository({ app: { name: "Bunyad" } });
  expect(c.get<string>("app.name")).toBe("Bunyad");
  c.set("app.env", "local");
  expect(c.get<string>("app.env")).toBe("local");
});

test("config helper uses default instance", () => {
  setConfigInstance(new ConfigRepository({ app: { debug: true } }));
  expect(config<boolean>("app.debug")).toBe(true);
});

test("Config facade get set has all", () => {
  setConfigInstance(new ConfigRepository({ app: { name: "Bunyad" } }));
  expect(Config.get<string>("app.name")).toBe("Bunyad");
  expect(Config.has("app.name")).toBe(true);
  Config.set("app.env", "testing");
  expect(Config.get<string>("app.env")).toBe("testing");
  expect(Config.all().app).toEqual({ name: "Bunyad", env: "testing" });
});

test("Config typed getters getMany prepend push", () => {
  setConfigInstance(
    new ConfigRepository({
      app: { name: "Bunyad", debug: "true", port: "3000", ratio: "1.5" },
      services: { drivers: ["redis"] },
    }),
  );
  expect(Config.string("app.name")).toBe("Bunyad");
  expect(Config.boolean("app.debug")).toBe(true);
  expect(Config.integer("app.port")).toBe(3000);
  expect(Config.float("app.ratio")).toBe(1.5);
  expect(Config.array("services.drivers")).toEqual(["redis"]);
  expect(Config.collection("services.drivers").all()).toEqual(["redis"]);
  expect(Config.getMany(["app.name", "app.port"])).toEqual({
    "app.name": "Bunyad",
    "app.port": "3000",
  });
  Config.prepend("services.drivers", "memory");
  Config.push("services.drivers", "file");
  expect(Config.array("services.drivers")).toEqual(["memory", "redis", "file"]);
});
