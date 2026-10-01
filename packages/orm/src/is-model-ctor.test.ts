import { expect, test } from "bun:test";
import { Model, isModelCtor } from "./index.ts";

class DemoUser extends Model {
  static table = "users";
}

test("isModelCtor accepts subclasses only", () => {
  expect(isModelCtor(DemoUser)).toBe(true);
  expect(isModelCtor(Model)).toBe(false);
  expect(isModelCtor(class {})).toBe(false);
  expect(isModelCtor(null)).toBe(false);
  expect(isModelCtor({ find: () => null })).toBe(false);
});
