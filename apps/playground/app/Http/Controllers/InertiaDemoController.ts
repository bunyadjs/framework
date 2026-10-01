import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Inertia } from "@bunyad/inertia";
import { Head } from "@bunyad/head";
import { LengthAwarePaginator } from "@bunyad/database";

const POSTS = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, title: `Post ${i + 1}` }));
const PER_PAGE = 15;

export default class InertiaDemoController {
  index() {
    Head.title("Inertia").description("Hello from Bunyad Inertia");
    return Inertia.render("Welcome", {
      title: "Inertia",
      message: "Hello from Bunyad",
    });
  }

  /** The Inertia 3 server features against the real client: /inertia/feed. */
  feed(request: Request) {
    const page = Number(request.input("page") ?? 1);
    const after = Number(request.input("after") ?? 0);
    return Inertia.render("Feed", {
      // <InfiniteScroll>: each page is merged into posts.data.
      posts: Inertia.scroll(() =>
        new LengthAwarePaginator(POSTS.slice((page - 1) * PER_PAGE, page * PER_PAGE), POSTS.length, PER_PAGE, page, { path: "/inertia/feed" }),
      ),
      // "More events" appends; the last event comes back updated and replaces its old copy.
      events: Inertia.merge(() => {
        if (after === 0) return [1, 2, 3].map((id) => ({ id, label: `Event ${id}` }));
        return [{ id: after, label: `Event ${after} (updated)` }, ...[1, 2, 3].map((n) => ({ id: after + n, label: `Event ${after + n}` }))];
      }).matchOn("id"),
      // Resolved once; kept by the client when you come back.
      loadedAt: Inertia.once(() => new Date().toISOString()),
    });
  }

  toast() {
    Inertia.flash("toast", "Saved.");
    return redirect("/inertia/feed");
  }
}
