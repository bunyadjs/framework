import { afterEach, expect, test } from "bun:test";
import { Get, Method, Name, Post, View } from "@bunyad/http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Router, collectFileRoutes, registerFileRoutes, relocateRouteScan, routeScanFiles, scanRoutes } from "../src/index.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "bunyad-file-routes-"));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

class ProductController {
  index() {}
  create() {}
  store() {}
  show() {}
  edit() {}
  update() {}
  destroy() {}
}
class IndexOnly {
  index() {}
}
@Method("POST")
class ExportController {
  handle() {}
}
class ReviewController {
  index() {}
  store() {}
}

const loaders: Record<string, Record<string, unknown>> = {};
const load = async (file: string) => {
  const key = Object.keys(loaders).find((k) => file.endsWith(k));
  if (!key) throw new Error(`no loader for ${file}`);
  return loaders[key]!;
};

function use(map: Record<string, Record<string, unknown>>) {
  for (const k of Object.keys(loaders)) delete loaders[k];
  Object.assign(loaders, map);
}

test("scan: reserved names, groups, params and private files", () => {
  const root = tree({
    "products/controller.ts": "",
    "products/requests.ts": "",
    "products/index.tsx": "",
    "products/_hooks/useX.ts": "",
    "products/[product]/show.tsx": "",
    "products/[product]/reviews/controller.ts": "",
    "products/notes.txt": "",
    "products/index.test.tsx": "",
    "(billing)/invoices/controller.ts": "",
  });
  const scan = scanRoutes(root);
  const byPath = Object.fromEntries(scan.folders.map((f) => [f.path, f]));

  expect(byPath["products"]!.uri).toBe("/products");
  expect(byPath["products"]!.memberParam).toBe("product");
  expect(byPath["products/[product]/reviews"]!.uri).toBe("/products/{product}/reviews");
  expect(byPath["products/[product]/reviews"]!.name).toBe("products.reviews");
  expect(byPath["(billing)/invoices"]!.uri).toBe("/invoices");
  expect(scan.stray.map((f) => f.split("/").pop())).toEqual(["notes.txt"]);
});

test("resource actions map to methods, URIs and names", async () => {
  const root = tree({ "products/controller.ts": "", "products/[product]/show.tsx": "", "products/index.tsx": "" });
  use({ "products/controller.ts": { default: ProductController } });
  const routes = await collectFileRoutes(scanRoutes(root), { load });
  const table = routes.map((r) => `${r.methods.join("|")} ${r.uri} ${r.name}`);

  expect(table).toEqual([
    "GET /products products.index",
    "POST /products products.store",
    "GET /products/create products.create",
    "GET /products/{product} products.show",
    "PUT|PATCH /products/{product} products.update",
    "DELETE /products/{product} products.destroy",
    "GET /products/{product}/edit products.edit",
  ]);
  expect(routes.find((r) => r.name === "products.show")!.view).toMatch(/\[product\]\/show\.tsx$/);
  expect(routes.find((r) => r.name === "products.index")!.view).toMatch(/products\/index\.tsx$/);
});

test("a controller defines only the routes it has methods for", async () => {
  const root = tree({ "tags/controller.ts": "" });
  use({ "tags/controller.ts": { default: IndexOnly } });
  const routes = await collectFileRoutes(scanRoutes(root), { load });
  expect(routes.map((r) => r.name)).toEqual(["tags.index"]);
});

test("single-action controller maps to the folder URL with its own method", async () => {
  const root = tree({ "products/export/controller.ts": "" });
  use({ "products/export/controller.ts": { default: ExportController } });
  const [route] = await collectFileRoutes(scanRoutes(root), { load });
  expect(route!.methods).toEqual(["POST"]);
  expect(route!.uri).toBe("/products/export");
  expect(route!.action).toBe("handle");
});

test("nested resource folders", async () => {
  const root = tree({ "products/[product]/reviews/controller.ts": "" });
  use({ "products/[product]/reviews/controller.ts": { default: ReviewController } });
  const routes = await collectFileRoutes(scanRoutes(root), { load });
  expect(routes.map((r) => `${r.methods[0]} ${r.uri} ${r.name}`)).toEqual([
    "GET /products/{product}/reviews products.reviews.index",
    "POST /products/{product}/reviews products.reviews.store",
  ]);
});

test("middleware.ts applies to the subtree; scope self limits it", async () => {
  const root = tree({
    "products/middleware.ts": "",
    "products/controller.ts": "",
    "products/[product]/reviews/controller.ts": "",
    "products/[product]/reviews/middleware.ts": "",
  });
  use({
    "products/controller.ts": { default: IndexOnly },
    "products/[product]/reviews/controller.ts": { default: IndexOnly },
    "products/middleware.ts": { default: ["auth"], scope: "self" },
    "products/[product]/reviews/middleware.ts": { default: ["auth", "throttle:5,1"] },
  });
  let routes = await collectFileRoutes(scanRoutes(root), { load });
  expect(routes.find((r) => r.name === "products.index")!.middleware).toEqual(["auth"]);
  // parent is scope=self, so the child gets only its own list
  expect(routes.find((r) => r.name === "products.reviews.index")!.middleware).toEqual(["auth", "throttle:5,1"]);

  use({
    "products/controller.ts": { default: IndexOnly },
    "products/[product]/reviews/controller.ts": { default: IndexOnly },
    "products/middleware.ts": { default: ["auth"] },
    "products/[product]/reviews/middleware.ts": { default: ["auth", "throttle:5,1"] },
  });
  routes = await collectFileRoutes(scanRoutes(root), { load });
  // inherited, duplicates run once
  expect(routes.find((r) => r.name === "products.reviews.index")!.middleware).toEqual(["auth", "throttle:5,1"]);
});

test("registerFileRoutes puts routes on the router; static wins over dynamic; duplicates fail", async () => {
  const root = tree({ "products/controller.ts": "" });
  use({ "products/controller.ts": { default: ProductController } });
  const router = new Router();
  await registerFileRoutes(root, router, { load });
  expect(router.match("GET", "/products/create")?.route.name).toBe("products.create");
  expect(router.match("GET", "/products/9")?.params.product).toBe("9");
  expect(router.route("products.show", { product: 9 })).toBe("/products/9");

  const dup = tree({ "a/controller.ts": "", "(g)/a/controller.ts": "" });
  use({ "a/controller.ts": { default: IndexOnly }, "(g)/a/controller.ts": { default: IndexOnly } });
  await expect(registerFileRoutes(dup, new Router(), { load })).rejects.toThrow(/Duplicate route GET \/a/);
});

test("route.ts declares a folder's own routes, relative to the folder, with subtree middleware", async () => {
  const { Route } = await import("../src/index.ts");
  class LoginController {
    create() {}
    store() {}
  }
  const root = tree({
    "middleware.ts": "",
    "login/controller.ts": "",
    "login/route.ts": "",
    "(admin)/reports/controller.ts": "",
  });
  use({
    "middleware.ts": { default: ["web"] },
    "login/controller.ts": { default: LoginController },
    "login/route.ts": {
      default: () => {
        Route.get("/", [LoginController, "create"]).name("login");
        Route.post("/", [LoginController, "store"]).middleware("throttle:5,1").name("login.store");
      },
    },
    "(admin)/reports/controller.ts": { default: IndexOnly },
  });
  const router = new Router();
  const routes = await registerFileRoutes(root, router, { load });

  // convention routes are skipped for a folder that has route.ts
  expect(routes.map((r) => r.name)).toEqual(["reports.index"]);
  expect(router.match("GET", "/login")?.route.name).toBe("login");
  expect(router.match("POST", "/login")?.route.name).toBe("login.store");
  expect(router.route("login")).toBe("/login");
  expect(router.match("GET", "/login")?.route.middleware).toContain("web");
  expect(router.match("POST", "/login")?.route.middleware).toEqual(["web", "throttle:5,1"]);
});

test("a folder with no index and no [param] child is one page at the folder URL", async () => {
  class LoginController {
    create() {}
    store() {}
  }
  class ProfileController {
    edit() {}
    update() {}
    destroy() {}
  }
  @Method("POST")
  class LogoutController {
    handle() {}
  }
  const root = tree({
    "(guest)/login/LoginController.ts": "",
    "settings/profile/ProfileController.ts": "",
    "(auth)/logout/LogoutController.ts": "",
  });
  use({
    "login/LoginController.ts": { default: LoginController },
    "profile/ProfileController.ts": { default: ProfileController },
    "logout/LogoutController.ts": { default: LogoutController },
  });
  const routes = await collectFileRoutes(scanRoutes(root), { load });
  const table = routes.map((r) => `${r.methods.join("|")} ${r.uri} ${r.name}`);
  expect(table).toEqual([
    "GET /login login",
    "POST /login login.store",
    "POST /logout logout",
    "GET /settings/profile settings.profile",
    "PUT|PATCH /settings/profile settings.profile.update",
    "DELETE /settings/profile settings.profile.destroy",
  ]);
});

test("descriptive filenames are reserved names; two controllers in a folder fail", () => {
  const root = tree({
    "login/LoginController.ts": "",
    "login/LoginRequest.ts": "",
    "login/LoginPolicy.ts": "",
    "login/helper.ts": "",
  });
  const login = scanRoutes(root).folders.find((f) => f.path === "login")!;
  expect(login.controller).toMatch(/LoginController\.ts$/);
  expect(login.requests).toMatch(/LoginRequest\.ts$/);
  expect(login.policy).toMatch(/LoginPolicy\.ts$/);
  expect(scanRoutes(root).stray.map((f) => f.split("/").pop())).toEqual(["helper.ts"]);

  const two = tree({ "x/AController.ts": "", "x/BController.ts": "" });
  expect(() => scanRoutes(two)).toThrow(/one controller per folder/);
});

test("@Name and @Method set a single-action route's name and verb", async () => {
  @Name("verification.verify")
  class VerifyController {
    handle() {}
  }
  const root = tree({ "email/verify/[id]/[hash]/VerifyController.ts": "" });
  use({ "VerifyController.ts": { default: VerifyController } });
  const [route] = await collectFileRoutes(scanRoutes(root), { load });
  expect(route!.name).toBe("verification.verify");
  expect(route!.uri).toBe("/email/verify/{id}/{hash}");
  expect(route!.methods).toEqual(["GET"]);
});

test("@Get/@Post declare extra routes relative to the folder; they replace the convention for that method", async () => {
  class TwoFactorController {
    show() {}
    store() {}
    destroy() {}
    @Post("/confirm")
    confirm() {}
    @Post("/recovery-codes")
    regenerate() {}
    @Get("/{token}")
    @Name("password.reset")
    create() {}
  }
  const root = tree({ "settings/two-factor/TwoFactorController.ts": "" });
  use({ "TwoFactorController.ts": { default: TwoFactorController } });
  const routes = await collectFileRoutes(scanRoutes(root), { load });
  const table = routes.map((r) => `${r.methods.join("|")} ${r.uri} ${r.name}`).sort();
  expect(table).toEqual([
    "DELETE /settings/two-factor settings.two-factor.destroy",
    "GET /settings/two-factor settings.two-factor",
    "GET /settings/two-factor/{token} password.reset",
    "POST /settings/two-factor settings.two-factor.store",
    "POST /settings/two-factor/confirm settings.two-factor.confirm",
    "POST /settings/two-factor/recovery-codes settings.two-factor.regenerate",
  ]);
});

test("a controller in a (group) folder can own several URLs with full paths", async () => {
  class SecurityController {
    @Get("/confirm-password")
    prompt() {}
    @Get("/email/verify")
    verify() {}
  }
  const root = tree({ "(auth)/SecurityController.ts": "" });
  use({ "SecurityController.ts": { default: SecurityController } });
  const routes = await collectFileRoutes(scanRoutes(root), { load });
  expect(routes.map((r) => r.uri).sort()).toEqual(["/confirm-password", "/email/verify"]);
});

test("views are found by descriptive names: a lone *Page is the GET page, XxxEditPage is edit", async () => {
  class LoginController {
    create() {}
    store() {}
  }
  class ProductController {
    index() {}
    edit() {}
  }
  const root = tree({
    "app/src/login/LoginController.ts": "",
    "app/src/login/LoginPage.tsx": "",
    "app/src/products/ProductController.ts": "",
    "app/src/products/ProductIndexPage.vue": "",
    "app/src/products/ProductEditPage.vue": "",
  });
  use({ "LoginController.ts": { default: LoginController }, "ProductController.ts": { default: ProductController } });
  const scan = scanRoutes(join(root, "app/src"));
  const routes = await collectFileRoutes(scan, { load });
  const view = (name: string) => routes.find((r) => r.name === name)?.view?.split("/").slice(-1)[0];
  expect(view("login")).toBe("LoginPage.tsx");
  expect(view("login.store")).toBeUndefined();
  expect(view("products.index")).toBe("ProductIndexPage.vue");
  expect(view("products.edit")).toBe("ProductEditPage.vue");

  const router = new Router();
  await registerFileRoutes(join(root, "app/src"), router, { load });
  expect(router.match("GET", "/login")?.route.page).toBe("src/login/LoginPage.tsx");
  expect(router.match("POST", "/login")?.route.page).toBeUndefined();
});

test("two generic pages in a folder fail", () => {
  const root = tree({ "x/APage.tsx": "", "x/BPage.tsx": "" });
  expect(() => scanRoutes(root)).toThrow(/two views for "page"/);
});

test("a folder with a page and no controller is a GET page named after the folder", async () => {
  const root = tree({
    "app/src/middleware.ts": "",
    "app/src/WelcomePage.tsx": "",
    "app/src/dashboard/middleware.ts": "",
    "app/src/dashboard/DashboardPage.tsx": "",
  });
  use({ "src/middleware.ts": { default: ["web"] }, "dashboard/middleware.ts": { default: ["auth"] } });
  const router = new Router();
  await registerFileRoutes(join(root, "app/src"), router, { load });
  expect(router.match("GET", "/")?.route.name).toBe("home");
  expect(router.match("GET", "/")?.route.page).toBe("src/WelcomePage.tsx");
  expect(router.match("GET", "/dashboard")?.route.name).toBe("dashboard");
  expect(router.match("GET", "/dashboard")?.route.middleware).toEqual(["web", "auth"]);
  expect(router.match("GET", "/dashboard")?.route.declaration).toEqual({ kind: "page" });
});

test("@View points an action at another view file", async () => {
  class ShareController {
    @View("../shared/FormPage.tsx")
    create() {}
    show() {}
  }
  const root = tree({
    "app/src/share/ShareController.ts": "",
    "app/src/share/SharePage.tsx": "",
    "app/src/shared/FormPage.tsx": "",
  });
  use({ "ShareController.ts": { default: ShareController } });
  const routes = await collectFileRoutes(scanRoutes(join(root, "app/src")), { load });
  const share = routes.filter((r) => r.controller === ShareController);
  expect(share.find((r) => r.action === "create")?.view).toMatch(/shared\/FormPage\.tsx$/);
  expect(share.find((r) => r.action === "show")?.view).toMatch(/share\/SharePage\.tsx$/);
});

test("a folder's view is its GET page, so the controller needs no empty method for it", async () => {
  class LoginController {
    store() {}
  }
  const root = tree({
    "app/src/login/LoginController.ts": "",
    "app/src/login/LoginPage.tsx": "",
  });
  use({ "LoginController.ts": { default: LoginController } });
  const router = new Router();
  await registerFileRoutes(join(root, "app/src"), router, { load });
  expect(router.match("GET", "/login")?.route.name).toBe("login");
  expect(router.match("GET", "/login")?.route.page).toBe("src/login/LoginPage.tsx");
  expect(router.match("POST", "/login")?.route.name).toBe("login.store");
});

test("an explicit GET action is used, not duplicated by the implied page", async () => {
  class LoginController {
    create() {
      return { a: 1 };
    }
  }
  const root = tree({ "app/src/login/LoginController.ts": "", "app/src/login/LoginPage.tsx": "" });
  use({ "LoginController.ts": { default: LoginController } });
  const routes = await collectFileRoutes(scanRoutes(join(root, "app/src")), { load });
  expect(routes.filter((r) => r.methods.includes("GET"))).toHaveLength(1);
  expect(routes[0]!.controller).toBe(LoginController);
});

test("middleware.ts can add a URL prefix and a group folder is a surface", async () => {
  class MeController {
    show() {}
  }
  class LoginController {
    store() {}
  }
  const root = tree({
    "app/src/(api)/middleware.ts": "",
    "app/src/(api)/me/MeController.ts": "",
    "app/src/(web)/middleware.ts": "",
    "app/src/(web)/login/LoginController.ts": "",
    "app/src/(web)/login/LoginPage.tsx": "",
  });
  use({
    "(api)/middleware.ts": { default: ["api"], prefix: "api" },
    "(web)/middleware.ts": { default: ["web"] },
    "MeController.ts": { default: MeController },
    "LoginController.ts": { default: LoginController },
  });
  const router = new Router();
  await registerFileRoutes(join(root, "app/src"), router, { load });
  expect(router.match("GET", "/api/me")?.route.middleware).toEqual(["api"]);
  expect(router.match("GET", "/me")).toBeFalsy();
  expect(router.match("GET", "/login")?.route.middleware).toEqual(["web"]);
  expect(router.match("POST", "/login")?.route.name).toBe("login.store");
});

test("a (group) folder may hold several controllers; routes carry a name and middleware; views match the method name", async () => {
  const mustBeSignedIn = async (_request: unknown, next: () => unknown) => next();
  class SessionController {
    @Get("/login", { name: "login" })
    login() {}
    @Post("/login", { name: "login.store" })
    authenticate() {}
    @Post("/logout", { name: "logout", middleware: [mustBeSignedIn as never] })
    logout() {}
    helper() {
      return 1;
    }
  }
  class RegistrationController {
    @Get("/register", { name: "register" })
    register() {}
  }
  const root = tree({
    "app/src/(auth)/SessionController.ts": "",
    "app/src/(auth)/RegistrationController.ts": "",
    "app/src/(auth)/LoginPage.tsx": "",
    "app/src/(auth)/RegisterPage.tsx": "",
  });
  use({ "SessionController.ts": { default: SessionController }, "RegistrationController.ts": { default: RegistrationController } });
  const router = new Router();
  await registerFileRoutes(join(root, "app/src"), router, { load });

  expect(router.match("GET", "/login")?.route.name).toBe("login");
  expect(router.match("POST", "/login")?.route.name).toBe("login.store");
  expect(router.match("GET", "/register")?.route.page).toBe("src/(auth)/RegisterPage.tsx");
  expect(router.match("GET", "/login")?.route.page).toBe("src/(auth)/LoginPage.tsx");
  expect(router.match("POST", "/login")?.route.page).toBeUndefined();
  // Undecorated methods are not routes, and the decorators' middleware is the controller's.
  expect(router.getRoutes().map((r) => r.uri).sort()).toEqual(["/login", "/login", "/logout", "/register"]);
  const { controllerMiddlewareOf } = await import("@bunyad/http");
  expect(controllerMiddlewareOf(SessionController, "logout")).toHaveLength(1);
});

test("two controllers in an ordinary folder still fail", () => {
  const two = tree({ "x/AController.ts": "", "x/BController.ts": "" });
  expect(() => scanRoutes(two)).toThrow(/one controller per folder/);
});

test("defaultMiddleware applies to the whole tree unless the root has a middleware.ts", async () => {
  class MeController {
    show() {}
  }
  const root = tree({ "app/src/me/MeController.ts": "" });
  use({ "MeController.ts": { default: MeController } });
  const router = new Router();
  await registerFileRoutes(join(root, "app/src"), router, { load, defaultMiddleware: ["web"] });
  expect(router.match("GET", "/me")?.route.middleware).toEqual(["web"]);

  const own = tree({ "app/src/middleware.ts": "", "app/src/me/MeController.ts": "" });
  use({ "src/middleware.ts": { default: [] }, "MeController.ts": { default: MeController } });
  const other = new Router();
  await registerFileRoutes(join(own, "app/src"), other, { load, defaultMiddleware: ["web"] });
  expect(other.match("GET", "/me")?.route.middleware).toEqual([]);
});

test("PascalCase folders are code, not routes", () => {
  const root = tree({
    "Models/User.ts": "",
    "Http/Middleware/Auth.ts": "",
    "login/LoginController.ts": "",
  });
  expect(scanRoutes(root).folders.map((f) => f.path).sort()).toEqual(["", "login"]);
});

test("views can live in a pages/ subfolder, apart from the controllers", async () => {
  class SessionController {
    @Get("/login", { name: "login" })
    login() {}
  }
  class ProfileController {
    edit() {}
  }
  const root = tree({
    "app/src/(auth)/SessionController.ts": "",
    "app/src/(auth)/pages/LoginPage.tsx": "",
    "app/src/settings/profile/ProfileController.ts": "",
    "app/src/settings/profile/pages/ProfilePage.tsx": "",
  });
  use({ "SessionController.ts": { default: SessionController }, "ProfileController.ts": { default: ProfileController } });
  const router = new Router();
  await registerFileRoutes(join(root, "app/src"), router, { load });
  expect(router.match("GET", "/login")?.route.page).toBe("src/(auth)/pages/LoginPage.tsx");
  expect(router.match("GET", "/settings/profile")?.route.page).toBe("src/settings/profile/pages/ProfilePage.tsx");
  expect(scanRoutes(join(root, "app/src")).folders.map((f) => f.path).sort()).toEqual(["", "(auth)", "settings", "settings/profile"]);
});

test("a folder without a controller uses the nearest one above, matching methods by folder name", async () => {
  class AuthController {
    login() {
      return { a: 1 };
    }
    postLogin() {}
    forgotPassword() {}
    resetPassword() {}
    postResetPassword() {}
    @Post("/logout", { name: "logout" })
    logout() {}
  }
  class ProfileController {
    profile() {}
    patchProfile() {}
    deleteProfile() {}
  }
  class OwnController {
    index() {}
  }
  const root = tree({
    "app/routes/(auth)/AuthController.ts": "",
    "app/routes/(auth)/(guest)/middleware.ts": "",
    "app/routes/(auth)/(guest)/login/LoginPage.tsx": "",
    "app/routes/(auth)/(guest)/forgot-password/ForgotPasswordPage.tsx": "",
    "app/routes/(auth)/(guest)/reset-password/[token]/ResetPasswordPage.tsx": "",
    "app/routes/(auth)/terms/TermsPage.tsx": "",
    "app/routes/settings/ProfileController.ts": "",
    "app/routes/settings/profile/ProfilePage.tsx": "",
    "app/routes/settings/billing/OwnController.ts": "",
  });
  use({
    "AuthController.ts": { default: AuthController },
    "ProfileController.ts": { default: ProfileController },
    "OwnController.ts": { default: OwnController },
    "(guest)/middleware.ts": { default: ["guest"] },
  });
  const router = new Router();
  await registerFileRoutes(join(root, "app/routes"), router, { load });
  const at = (m: string, u: string) => router.match(m, u)?.route;

  expect(at("GET", "/login")?.name).toBe("login");
  expect(at("GET", "/login")?.page).toBe("routes/(auth)/(guest)/login/LoginPage.tsx");
  expect(at("GET", "/login")?.middleware).toEqual(["guest"]);
  expect(at("POST", "/login")?.name).toBe("login.store");
  expect(at("POST", "/login")?.page).toBeUndefined();
  // a method named for the folder answers GET; the folder's view renders its data
  expect(at("GET", "/forgot-password")?.action).toEqual([AuthController, "forgotPassword"]);
  expect(at("GET", "/forgot-password")?.middleware).toEqual(["guest"]);
  // the parameter folder uses the name of the folder above it
  expect(at("GET", "/reset-password/abc")?.page).toBe("routes/(auth)/(guest)/reset-password/[token]/ResetPasswordPage.tsx");
  expect(at("POST", "/reset-password")?.name).toBe("reset-password.store");
  // a view in a folder with no matching method and no inherited controller method is a page
  expect(at("GET", "/terms")?.declaration).toEqual({ kind: "page" });
  // declared routes are not also matched by name
  expect(at("POST", "/logout")?.name).toBe("logout");
  // inherited from the group above settings, one page per folder
  expect(at("GET", "/settings/profile")?.action).toEqual([ProfileController, "profile"]);
  expect(at("PATCH", "/settings/profile")?.name).toBe("settings.profile.update");
  expect(at("PUT", "/settings/profile")?.name).toBe("settings.profile.update");
  expect(at("DELETE", "/settings/profile")?.name).toBe("settings.profile.destroy");
  // a folder with its own controller overrides the one above
  expect(at("GET", "/settings/billing")?.action).toEqual([OwnController, "index"]);
});

test("an area's *.routes.ts gives middleware by URL, a subtree rule, and a prefix", async () => {
  class AuthController {
    postLogin() {}
    postResetPassword() {}
    resetPassword() {}
    @Post("/logout", { name: "logout" })
    logout() {}
  }
  const root = tree({
    "app/routes/(authentication)/AuthController.ts": "",
    "app/routes/(authentication)/authentication.routes.ts": "",
    "app/routes/(authentication)/login/LoginPage.tsx": "",
    "app/routes/(authentication)/reset-password/[token]/ResetPasswordPage.tsx": "",
    "app/routes/(authentication)/confirm-password/ConfirmPage.tsx": "",
    "app/routes/app.routes.ts": "",
    "app/routes/dashboard/DashboardPage.tsx": "",
    "app/routes/settings/profile/ProfilePage.tsx": "",
    "app/routes/(api)/api.routes.ts": "",
    "app/routes/(api)/me/MeController.ts": "",
  });
  class MeController {
    show() {}
  }
  use({
    "AuthController.ts": { default: AuthController },
    "MeController.ts": { default: MeController },
    "authentication.routes.ts": { default: { rules: { guest: ["login", "reset-password/*"], auth: ["confirm-password", "logout"] } } },
    "app.routes.ts": { default: { rules: { auth: ["dashboard", "settings/**"], verified: "dashboard" } } },
    "api.routes.ts": { default: { prefix: "api", use: ["api"] } },
  });
  const router = new Router();
  await registerFileRoutes(join(root, "app/routes"), router, { load, defaultMiddleware: ["web"] });
  const at = (m: string, u: string) => router.match(m, u)?.route;

  expect(at("GET", "/login")?.middleware).toEqual(["web", "guest"]);
  expect(at("POST", "/login")?.middleware).toEqual(["web", "guest"]);
  expect(at("GET", "/reset-password/abc")?.middleware).toEqual(["web", "guest"]);
  expect(at("POST", "/reset-password")?.middleware).toEqual(["web"]);
  expect(at("GET", "/confirm-password")?.middleware).toEqual(["web", "auth"]);
  expect(at("POST", "/logout")?.middleware).toEqual(["web", "auth"]);
  expect(at("GET", "/dashboard")?.middleware).toEqual(["web", "auth", "verified"]);
  expect(at("GET", "/settings/profile")?.middleware).toEqual(["web", "auth"]);
  // a group with a prefix: its middleware is added to the default, and its URLs are prefixed
  expect(at("GET", "/api/me")?.middleware).toEqual(["web", "api"]);
});

test("a rule that matches no route is an error", async () => {
  class AuthController {
    postLogin() {}
  }
  const root = tree({
    "app/routes/AuthController.ts": "",
    "app/routes/app.routes.ts": "",
    "app/routes/login/LoginPage.tsx": "",
  });
  use({ "AuthController.ts": { default: AuthController }, "app.routes.ts": { default: { rules: { guest: ["login", "logn"] } } } });
  await expect(registerFileRoutes(join(root, "app/routes"), new Router(), { load })).rejects.toThrow(/"guest" matches no route for "logn"/);
});

test("an area's access is set once; rules and { access } on a route replace it", async () => {
  class AuthController {
    postLogin() {}
    postConfirmPassword() {}
    @Post("/logout", { name: "logout", access: "auth" })
    logout() {}
  }
  const root = tree({
    "app/routes/(auth)/AuthController.ts": "",
    "app/routes/(auth)/auth.routes.ts": "",
    "app/routes/(auth)/login/LoginPage.tsx": "",
    "app/routes/(auth)/register/RegisterPage.tsx": "",
    "app/routes/(auth)/confirm-password/ConfirmPage.tsx": "",
  });
  use({
    "AuthController.ts": { default: AuthController },
    "auth.routes.ts": { default: { access: "guest", rules: { auth: ["confirm-password"] } } },
  });
  const router = new Router();
  await registerFileRoutes(join(root, "app/routes"), router, { load, defaultMiddleware: ["web"] });
  const at = (m: string, u: string) => router.match(m, u)?.route.middleware;

  // guest for the whole area, so no page or method has to repeat it
  expect(at("GET", "/login")).toEqual(["web", "guest"]);
  expect(at("POST", "/login")).toEqual(["web", "guest"]);
  expect(at("GET", "/register")).toEqual(["web", "guest"]);
  // an exception: auth takes the place of guest, for the page and its form post
  expect(at("GET", "/confirm-password")).toEqual(["web", "auth"]);
  expect(at("POST", "/confirm-password")).toEqual(["web", "auth"]);
  // a decorated route says its own access
  expect(at("POST", "/logout")).toEqual(["web", "auth"]);
});

test("tests and helpers in a _tests/ folder are not routes", () => {
  const root = tree({
    "login/LoginPage.tsx": "",
    "login/_tests/login.test.ts": "",
    "login/_tests/helpers.ts": "",
    "login/login.test.ts": "",
  });
  const scan = scanRoutes(root);
  expect(scan.folders.map((f) => f.path).sort()).toEqual(["", "login"]);
  expect(scan.stray).toEqual([]);
});

test("a [param] folder's page is the view of its parent controller's show, not a second route", async () => {
  class ResetController {
    @Name("password.reset")
    show() {
      return { token: 1 };
    }
    store() {}
  }
  const root = tree({
    "app/routes/reset-password/ResetController.ts": "",
    "app/routes/reset-password/[token]/ResetPage.tsx": "",
  });
  use({ "ResetController.ts": { default: ResetController } });
  const router = new Router();
  await registerFileRoutes(join(root, "app/routes"), router, { load });
  const hit = router.match("GET", "/reset-password/abc")?.route;
  expect(hit?.name).toBe("password.reset");
  expect(hit?.action).toEqual([ResetController, "show"]);
  expect(hit?.page).toBe("routes/reset-password/[token]/ResetPage.tsx");
  expect(router.match("POST", "/reset-password")?.route.name).toBe("reset-password.store");
});

test("a Live component is the page of its folder, named by its path in the tree", async () => {
  class LoginLive {
    static routeName = "login";
  }
  class ResetLive {}
  const root = tree({
    "(auth)/login/LoginLive.ts": "",
    "(auth)/login/LoginPage.view": "",
    "(auth)/reset-password/[token]/ResetLive.ts": "",
  });
  use({ "LoginLive.ts": { default: LoginLive }, "ResetLive.ts": { default: ResetLive } });

  const routes = await collectFileRoutes(scanRoutes(root), { load });
  const summary = routes.map((r) => ({ uri: r.uri, name: r.name, live: r.live?.name }));
  expect(summary).toContainEqual({ uri: "/login", name: "login", live: "(auth).login.LoginLive" });
  expect(summary).toContainEqual({ uri: "/reset-password/{token}", name: "reset-password", live: "(auth).reset-password.[token].ResetLive" });
  // The template beside the component is not a second route.
  expect(routes.filter((r) => r.uri === "/login")).toHaveLength(1);
});

test("a strict area needs every route to say who may open it, and `public` opens one", async () => {
  class AccountController {
    show() {}
    update() {}
  }
  class PricingController {
    show() {}
  }
  const files = {
    "(app)/app.routes.ts": "",
    "(app)/account/AccountController.ts": "",
    "(app)/pricing/PricingController.ts": "",
  };
  const loaders = (config: Record<string, unknown>) => ({
    "app.routes.ts": { default: config },
    "AccountController.ts": { default: AccountController },
    "PricingController.ts": { default: PricingController },
  });

  use(loaders({ strict: true, rules: { auth: "account" } }));
  await expect(collectFileRoutes(scanRoutes(tree(files)), { load })).rejects.toThrow(/strict area, but no access is declared for GET \/pricing/);

  use(loaders({ strict: true, rules: { auth: "account", public: "pricing" } }));
  const routes = await collectFileRoutes(scanRoutes(tree(files)), { load });
  expect(routes.find((r) => r.uri === "/pricing")!.middleware).toEqual([]);
  expect(routes.find((r) => r.uri === "/account")!.middleware).toEqual(["auth"]);
});

test("an area on a domain answers on that host only; {root} is the app's domain", async () => {
  class DashboardController {
    show() {}
  }
  class HomeController {
    show() {}
  }
  const root = tree({
    "(admin)/admin.routes.ts": "",
    "(admin)/dashboard/DashboardController.ts": "",
    "(tenant)/tenant.routes.ts": "",
    "(tenant)/home/HomeController.ts": "",
  });
  use({
    "admin.routes.ts": { default: { domain: "admin.{root}" } },
    "tenant.routes.ts": { default: { domain: ["{tenant}.{root}", "shop.example.net"] } },
    "DashboardController.ts": { default: DashboardController },
    "HomeController.ts": { default: HomeController },
  });
  const router = new Router();
  const routes = await registerFileRoutes(root, router, { load, vars: { root: "example.test" } });

  expect(routes.find((r) => r.uri === "/dashboard")!.domains).toEqual(["admin.example.test"]);
  expect(router.match("GET", "/dashboard", "admin.example.test")?.route.name).toBe("dashboard");
  expect(router.match("GET", "/home", "acme.example.test")?.params.tenant).toBe("acme");
  expect(router.match("GET", "/home", "shop.example.net")?.route.uri).toBe("/home");
  expect(router.match("GET", "/home", "nope.test")).toBeUndefined();
});

test("a stored scan can be moved to another root and registered without the source tree", async () => {
  class ThingController {
    index() {}
  }
  const root = tree({ "things/ThingController.ts": "" });
  const scan = scanRoutes(root);
  expect(routeScanFiles(scan).map((f) => f.slice(root.length))).toEqual(["/things/ThingController.ts"]);

  const moved = relocateRouteScan(JSON.parse(JSON.stringify(scan)), root, "/virtual/routes");
  rmSync(root, { recursive: true, force: true });
  use({ "ThingController.ts": { default: ThingController } });

  const router = new Router();
  const routes = await registerFileRoutes(moved, router, { load });
  expect(routes.map((r) => r.uri)).toEqual(["/things"]);
  expect(router.match("GET", "/things")).toBeDefined();
});

test("a route decorator can limit a parameter with where", async () => {
  class FilesController {
    @Get("/{key}", { name: "files.show", where: { key: ".+" } })
    show() {}
  }
  const root = tree({ "files/FilesController.ts": "" });
  use({ "FilesController.ts": { default: FilesController } });
  const router = new Router();
  await registerFileRoutes(root, router, { load });
  expect(router.match("GET", "/files/a/b/c.png")?.params.key).toBe("a/b/c.png");
});

test("excluded folders are not registered", async () => {
  class AController {
    index() {}
  }
  class BController {
    index() {}
  }
  const root = tree({ "(shop)/a/AController.ts": "", "(central)/b/BController.ts": "" });
  use({ "AController.ts": { default: AController }, "BController.ts": { default: BController } });
  const router = new Router();
  const routes = await registerFileRoutes(root, router, { load, exclude: ["(central)"] });
  expect(routes.map((r) => r.uri)).toEqual(["/a"]);
});

test("the views below a spa.routes.ts are routed in the browser, not by the server", async () => {
  class OrderController {
    index() {}
  }
  const root = tree({
    "app/spa.routes.ts": "",
    "app/sales/SalesPage.tsx": "",
    "app/sales/[orderId]/OrderPage.tsx": "",
    "orders/OrderController.ts": "",
    "orders/OrdersPage.tsx": "",
  });
  use({ "OrderController.ts": { default: OrderController }, "spa.routes.ts": { default: {} } });
  const routes = await collectFileRoutes(scanRoutes(root), { load });
  expect(routes.map((r) => r.uri)).toEqual(["/orders"]);
});
