import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class SxAuthor extends Model {
  static table = "sx_authors";
  static fillable = ["name", "big", "pw"];
  static hidden = ["pw"];
  static appends = ["shout"];
  static casts() { return { big: "bigint" as const }; }
  declare id: number;
  declare name: string;
  declare big: bigint;
  getShoutAttribute() { return String(this.name).toUpperCase(); }
  books() { return this.hasMany(SxBook, "author_id"); }
  profile() { return this.hasOne(SxProfile, "author_id"); }
}
class SxBook extends Model {
  static table = "sx_books";
  static fillable = ["author_id", "title", "isbn"];
  static hidden = ["isbn"];
  declare id: number;
  author() { return this.belongsTo(SxAuthor, "author_id"); }
  tags() { return this.belongsToMany(SxTag, "sx_book_tag", "book_id", "tag_id").withPivot("weight"); }
}
class SxTag extends Model {
  static table = "sx_tags";
  static fillable = ["name"];
  declare id: number;
}
class SxProfile extends Model {
  static table = "sx_profiles";
  static fillable = ["author_id", "bio"];
}

describe.each(drivers.map((d) => [d.name, d] as const))("serialization edge cases (%s)", (_name, driver) => {
  const c = driver.connection;
  const tables = ["sx_book_tag", "sx_profiles", "sx_tags", "sx_books", "sx_authors"];
  let authorId: number;

  beforeAll(async () => {
    Model.setConnection(c);
    const schema = schemaFor(c);
    for (const t of tables) await schema.dropIfExists(t);
    await schema.create("sx_authors", (b) => { b.id(); b.string("name"); b.bigInteger("big").nullable(); b.string("pw").nullable(); b.timestamps(); });
    await schema.create("sx_books", (b) => { b.id(); b.integer("author_id"); b.string("title"); b.string("isbn").nullable(); b.timestamps(); });
    await schema.create("sx_tags", (b) => { b.id(); b.string("name"); b.timestamps(); });
    await schema.create("sx_profiles", (b) => { b.id(); b.integer("author_id"); b.string("bio"); b.timestamps(); });
    await schema.create("sx_book_tag", (b) => { b.integer("book_id"); b.integer("tag_id"); b.integer("weight").nullable(); });
    const a = await SxAuthor.create({ name: "ada", big: 42n, pw: "secret" });
    authorId = a.id;
    const book = await SxBook.create({ author_id: a.id, title: "B1", isbn: "123" });
    await SxBook.create({ author_id: a.id, title: "B2", isbn: "456" });
    const tag = await SxTag.create({ name: "t" });
    await book.tags().attach([tag.id], { weight: 7 });
  });
  afterAll(async () => {
    const schema = schemaFor(c);
    for (const t of tables) await schema.dropIfExists(t);
  });

  test("a bigint cast serializes as a decimal string instead of throwing", async () => {
    const a = (await SxAuthor.find(authorId))!;
    const json = JSON.parse(JSON.stringify(a));
    expect(json.big).toBe("42");
    expect(a.toArray().big).toBe(42n); // toArray keeps the native value
  });

  test("hidden stays hidden and appends are present, at every depth", async () => {
    const a = (await SxAuthor.with("books").find(authorId))!;
    const json = JSON.parse(JSON.stringify(a));
    expect(json.pw).toBeUndefined();
    expect(json.shout).toBe("ADA");
    expect(json.books.map((b: any) => b.isbn)).toEqual([undefined, undefined]);
  });

  test("a relation that loaded as empty or missing serializes as [] or null", async () => {
    const noBooks = await SxAuthor.create({ name: "none" });
    const json = JSON.parse(JSON.stringify((await SxAuthor.with("books", "profile").find(noBooks.id))!));
    expect(json.books).toEqual([]);
    expect(json.profile).toBeNull();
  });

  test("relation keys keep the name used in with()", async () => {
    const book = (await SxBook.with("author", "tags").orderBy("id").first())!;
    const json = JSON.parse(JSON.stringify(book));
    expect(json.author.name).toBe("ada");
    expect(json.author.pw).toBeUndefined();
    expect(json.tags[0].pivot).toEqual({ book_id: expect.anything(), tag_id: expect.anything(), weight: 7 });
  });

  test("aggregate columns are included next to attributes", async () => {
    const a = (await SxAuthor.withCount("books").find(authorId))!;
    expect(Number(JSON.parse(JSON.stringify(a)).books_count)).toBe(2);
  });

  test("a collection and a paginator serialize every model with its rules", async () => {
    const all = JSON.parse(JSON.stringify(await SxBook.orderBy("id").get()));
    expect(all.map((b: any) => b.title)).toEqual(["B1", "B2"]);
    expect(all.every((b: any) => b.isbn === undefined)).toBe(true);
    for (const run of [
      () => SxBook.orderBy("id").paginate(1),
      () => SxBook.orderBy("id").simplePaginate(1),
      () => SxBook.orderBy("id").cursorPaginate(1),
    ]) {
      const page = JSON.parse(JSON.stringify(await run()));
      expect(page.data).toHaveLength(1);
      expect(page.data[0].title).toBe("B1");
      expect(JSON.stringify(page)).not.toContain("isbn");
    }
  });

  test("a loaded inverse relation does not recurse forever", async () => {
    const a = (await SxAuthor.with("books.author").find(authorId))!;
    expect(() => JSON.stringify(a)).not.toThrow();
  });
});
