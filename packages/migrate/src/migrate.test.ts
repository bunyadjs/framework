import { expect, test } from "bun:test";
import {
  analyzePhpSource,
  convertBladeToView,
  convertControllerStub,
  convertModelStub,
  convertPhpFile,
  convertRoutesStub,
  findCompatibilityIssues,
  formatReport,
  scanPhpDirectory,
} from "../src/index.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sampleController = `<?php

namespace App\\Http\\Controllers;

use Illuminate\\Support\\Facades\\Auth;

class PostController
{
    public function index()
    {
        return view('posts.index');
    }

    public function store(Request $request)
    {
        Auth::user();
        return redirect('/posts');
    }
}
`;

test("analyzePhpSource detects controller methods", () => {
  const info = analyzePhpSource(
    "app/Http/Controllers/PostController.php",
    sampleController,
  );
  expect(info.kind).toBe("controller");
  expect(info.className).toBe("PostController");
  expect(info.methods).toEqual(["index", "store"]);
});

test("findCompatibilityIssues flags facades", () => {
  const issues = findCompatibilityIssues(
    "app/Http/Controllers/PostController.php",
    sampleController,
  );
  expect(issues.some((i) => i.feature === "facade")).toBe(true);
});

test("convertControllerStub emits TS skeleton", () => {
  const ts = convertControllerStub(
    sampleController,
    "app/Http/Controllers/PostController.php",
  );
  expect(ts).toContain("export default class PostController");
  expect(ts).toContain("async index(request: Request)");
  expect(ts).toContain("TODO: migrate from PHP PostController::index()");
});

test("convertModelStub emits model skeleton", () => {
  const php = `class User extends Model {
  protected $table = 'users';
  protected $fillable = ['name', 'email'];
}`;
  const ts = convertModelStub(php, "app/Models/User.php");
  expect(ts).toContain('static table = "users"');
  expect(ts).toContain("declare name: string");
});

test("convertRoutesStub maps Route::get lines", () => {
  const php = `Route::get('/dashboard', [DashboardController::class, 'index']);`;
  const ts = convertRoutesStub(php, "routes/web.php");
  expect(ts).toContain(
    'Route.get("/dashboard", [DashboardController, "index"])',
  );
});

test("convertBladeToView strips dollar signs", () => {
  const blade = `@extends('layouts.app')\n<h1>{{ $title }}</h1>`;
  const view = convertBladeToView(blade, "welcome.blade.php");
  expect(view).toContain("{{ title }}");
  expect(view).toContain("welcome.view");
});

test("convertPhpFile picks converter by path", () => {
  const model = convertPhpFile(
    "class Post extends Model {}",
    "app/Models/Post.php",
  );
  expect(model).toContain("extends Model");
});

test("convertPhpFile emits migration stub for database/migrations", async () => {
  const { convertMigrationStub, classifyPhpFile } = await import(
    "../src/index.ts"
  );
  const path = "database/migrations/2024_01_01_000000_create_posts_table.php";
  expect(classifyPhpFile(path)).toBe("migration");
  const php = `<?php
class CreatePostsTable {
  public function up() { Schema::create('posts', function () {}); }
  public function down() { Schema::drop('posts'); }
}`;
  const ts = convertMigrationStub(php, path);
  expect(ts).toContain("export async function up");
  expect(ts).toContain("export async function down");
  expect(ts).toContain("TODO: migrate Schema::");
  expect(convertPhpFile(php, path)).toContain("export async function up");
});

test("convertPhpFile emits middleware and job stubs", () => {
  const mw = convertPhpFile(
    "class EnsureToken { public function handle($request, $next) {} }",
    "app/Http/Middleware/EnsureToken.php",
  );
  expect(mw).toContain("export default class EnsureToken");
  expect(mw).toContain("async handle(request: Request");

  const job = convertPhpFile(
    "class SendMail { public function handle() {} }",
    "app/Jobs/SendMail.php",
  );
  expect(job).toContain("extends Job");
  expect(job).toContain("SendMail");
});

test("convertFormRequestStub maps rules and authorize", async () => {
  const { convertFormRequestStub, classifyPhpFile } =
    await import("../src/index.ts");
  expect(classifyPhpFile("app/Http/Requests/StorePostRequest.php")).toBe(
    "request",
  );
  const php = `<?php
class StorePostRequest extends FormRequest {
  public function authorize() { return true; }
  public function rules() {
    return [
      'title' => 'required|string|max:255',
      'body' => 'required',
    ];
  }
}`;
  const ts = convertFormRequestStub(
    php,
    "app/Http/Requests/StorePostRequest.php",
  );
  expect(ts).toContain("extends FormRequest");
  expect(ts).toContain('title: "required|string|max:255"');
  expect(ts).toContain('body: "required"');
  expect(ts).toContain("return true");
});

test("convertPolicyStub emits policy skeleton", async () => {
  const { convertPolicyStub, classifyPhpFile } =
    await import("../src/index.ts");
  expect(classifyPhpFile("app/Policies/PostPolicy.php")).toBe("policy");
  const php = `<?php
class PostPolicy {
  public function view(User $user, Post $post) { return true; }
  public function create(User $user) { return true; }
}`;
  const ts = convertPolicyStub(php, "app/Policies/PostPolicy.php");
  expect(ts).toContain("export default class PostPolicy");
  expect(ts).toContain("view(user: GateUser, model: Post)");
  expect(ts).toContain("create(user: GateUser)");
});

test("convertRoutesStub maps groups verbs and resources", () => {
  const php = `
Route::middleware('auth')->prefix('admin')->name('admin.')->group(function () {
    Route::get('/dashboard', [DashboardController::class, 'index']);
    Route::put('/posts/{post}', [PostController::class, 'update']);
    Route::apiResource('posts', PostController::class);
});
`;
  const ts = convertRoutesStub(php, "routes/web.php");
  expect(ts).toContain(
    'Route.group({ middleware: ["auth"], prefix: "admin", name: "admin." }',
  );
  expect(ts).toContain(
    'Route.get("/dashboard", [DashboardController, "index"])',
  );
  expect(ts).toContain(
    'Route.put("/posts/{post}", [PostController, "update"])',
  );
  expect(ts).toContain('Route.apiResource("posts", PostController)');
  expect(ts).toContain("});");
});

test("scanPhpDirectory walks project tree", async () => {
  const root = resolve(import.meta.dir, "../.tmp-scan");
  await rm(root, { recursive: true, force: true });
  await mkdir(resolve(root, "app/Http/Controllers"), { recursive: true });
  await writeFile(
    resolve(root, "app/Http/Controllers/UserController.php"),
    sampleController,
  );

  const report = await scanPhpDirectory(root);
  expect(report.files).toHaveLength(1);
  expect(formatReport(report)).toContain("PostController");
  await rm(root, { recursive: true, force: true });
});
