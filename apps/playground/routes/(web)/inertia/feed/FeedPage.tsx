import { InfiniteScroll, Link, router, usePage } from "@inertiajs/react";

type Post = { id: number; title: string };
type Event = { id: number; label: string };
type Props = { posts: { data: Post[] }; events: Event[]; loadedAt: string };

/** Inertia 3 features: infinite scroll, merge props, once props, and flash. */
export default function Feed() {
  const page = usePage<Props>();
  const { posts, events, loadedAt } = page.props;
  const flash = (page as unknown as { flash: { toast?: string } }).flash;

  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Feed</h1>
      <p>Loaded at <span id="loaded-at">{loadedAt}</span> (a once prop).</p>
      <p>
        <button type="button" onClick={() => router.post("/inertia/feed/toast")}>Save</button>{" "}
        <span id="toast">{flash?.toast}</span>
      </p>
      <p><Link href="/inertia">Another page</Link> · <Link href="/inertia/feed" id="revisit">Visit this page again</Link></p>

      <h2>Events</h2>
      <ul id="events">{events.map((event) => <li key={event.id}>{event.label}</li>)}</ul>
      <button type="button" id="more-events" onClick={() => router.reload({ only: ["events"], data: { after: events.at(-1)!.id } })}>
        More events
      </button>

      <h2>Posts</h2>
      <InfiniteScroll data="posts">
        {posts.data.map((post) => (
          <div key={post.id} className="post" style={{ height: 60, borderBottom: "1px solid #ddd" }}>{post.title}</div>
        ))}
      </InfiniteScroll>
    </main>
  );
}
