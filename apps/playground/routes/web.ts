import { auth, can, guest } from "@bunyad/auth";
import { throttle } from "@bunyad/http";
import { Route, type Router } from "@bunyad/router";
import ApiTokenController from "../app/Http/Controllers/ApiTokenController.ts";
import AuthController from "../app/Http/Controllers/AuthController.ts";
import BenchController from "../app/Http/Controllers/BenchController.ts";
import BroadcastingController from "../app/Http/Controllers/BroadcastingController.ts";
import HelloController from "../app/Http/Controllers/HelloController.ts";
import HorizonController from "../app/Http/Controllers/HorizonController.ts";
import NotificationController from "../app/Http/Controllers/NotificationController.ts";
import NoteController from "../app/Http/Controllers/NoteController.ts";
import NotesPageController from "../app/Http/Controllers/NotesPageController.ts";
import PostController from "../app/Http/Controllers/PostController.ts";
import UserController from "../app/Http/Controllers/UserController.ts";
import WelcomeController from "../app/Http/Controllers/WelcomeController.ts";
import InertiaDemoController from "../app/Http/Controllers/InertiaDemoController.ts";
import LiveDemoController from "../app/Http/Controllers/LiveDemoController.ts";
import FeatureDemoController from "../app/Http/Controllers/FeatureDemoController.ts";
import DatabaseDemoController from "../app/Http/Controllers/DatabaseDemoController.ts";
import Post from "../app/Models/Post.ts";
import User from "../app/Models/User.ts";
import { Live } from "@bunyad/live";
import { Metrics } from "@bunyad/metrics";
import Note from "../app/Models/Note.ts";

export default function (router: Router = Route): void {
  // Route façade is bound to `router` by loadRouteModule / setActiveRouter.
  // Explicit overrides still work; convention + typed params also register binders.
  Route.model("user", User);
  Route.model("post", Post);
  Route.model("note", Note);

  // Microbench routes — no session / CSRF. Pair with `/bench/bun/*` in server.ts.
  Route.get("/bench/hello", [BenchController, "hello"]).name("bench.hello");
  Route.get("/bench/select", [BenchController, "select"]).name("bench.select");
  Route
    .post("/bench/insert", [BenchController, "insert"])
    .name("bench.insert");

  Route.middleware("web").group(() => {
    Live.routes(Route);
    Metrics.routes(Route);

    Route.get("/", [HelloController, "index"]).name("home");
    Route.get("/welcome", [WelcomeController, "index"]).name("welcome");
    Route.get("/inertia", [InertiaDemoController, "index"]).name("inertia");
    Route.get("/inertia/feed", [InertiaDemoController, "feed"]).name("inertia.feed");
    Route.post("/inertia/feed/toast", [InertiaDemoController, "toast"]).name("inertia.feed.toast");
    Route.get("/livewire", [LiveDemoController, "index"]).name("wire");
    Route
      .get("/livewire/about", [LiveDemoController, "about"])
      .name("livewire.about");
    Route.get("/features", [FeatureDemoController, "index"]).name("features");
    Route
      .get("/databases", [DatabaseDemoController, "index"])
      .name("databases");
    Route.post("/users", [UserController, "store"]).name("users.store");
    Route.post("/posts", [PostController, "store"]).name("posts.store");
    Route.get("/posts/{post}", [PostController, "show"]).name("posts.show");

    Route
      .middleware(
        auth(),
        can("delete", "post"),
      )
      .group(() => {
        Route
          .delete("/posts/{post}", [PostController, "destroy"])
          .name("posts.destroy");
      });

    Route.middleware(guest()).group(() => {
      Route.get("/login", [AuthController, "showLogin"]).name("login");
      Route.get("/register", [AuthController, "showRegister"]).name("register");

      Route.middleware(throttle("auth")).group(() => {
        Route.post("/login", [AuthController, "login"]).name("login.attempt");
        Route
          .post("/register", [AuthController, "register"])
          .name("register.store");
      });
    });

    Route.post("/logout", [AuthController, "logout"]).name("logout");

    Route.middleware(auth()).group(() => {
      Route.get("/dashboard", [AuthController, "dashboard"]).name("dashboard");
      Route.get("/notes", [NotesPageController, "index"]).name("notes.page");
      Route
        .get("/notes/sync-events", [BroadcastingController, "sse"])
        .name("notes.sync-events");
      Route.get("/horizon", [HorizonController, "index"]).name("horizon");
      Route
        .get("/horizon/api/stats", [HorizonController, "stats"])
        .name("horizon.stats");
      Route
        .post("/horizon/api/failed/{id}/retry", [HorizonController, "retry"])
        .name("horizon.retry");
      Route
        .post("/horizon/api/retry-all", [HorizonController, "retryAll"])
        .name("horizon.retry-all");
    });
  });

  Route.middleware("api").group(() => {
    // Lightweight JSON endpoints (no session / CSRF / Inertia).
    Route.get("/hello/{name}", [HelloController, "show"]).name("hello.show");
    Route.get("/users", [UserController, "index"]).name("users.index");
    Route.get("/users/{user}", [UserController, "show"]).name("users.show");
    Route
      .get("/users/{user}/posts", [UserController, "posts"])
      .name("users.posts");

    Route
      .get("/api/broadcasting/sse", [BroadcastingController, "sse"])
      .name("broadcasting.sse");
    Route
      .post("/api/broadcasting/auth", [BroadcastingController, "auth"])
      .name("broadcasting.auth");

    Route.middleware(throttle("tokens")).group(() => {
      Route
        .post("/api/token", [ApiTokenController, "store"])
        .name("api.token");
    });

    Route.middleware(throttle("api")).group(() => {
      Route.middleware(auth({ guard: "token" })).group(() => {
        Route.get("/api/me", [ApiTokenController, "me"]).name("api.me");
        Route
          .delete("/api/token", [ApiTokenController, "destroy"])
          .name("api.token.revoke");
        Route
          .get("/api/notifications", [NotificationController, "index"])
          .name("notifications.index");
        Route
          .post("/api/notifications/{id}/read", [
            NotificationController,
            "markRead",
          ])
          .name("notifications.read");
        Route.get("/api/notes", [NoteController, "index"]).name("notes.index");
        Route.post("/api/notes", [NoteController, "store"]).name("notes.store");
        Route
          .patch("/api/notes/{note}", [NoteController, "update"])
          .name("notes.update");
        Route
          .delete("/api/notes/{note}", [NoteController, "destroy"])
          .name("notes.destroy");
      });
    });

  });
}
