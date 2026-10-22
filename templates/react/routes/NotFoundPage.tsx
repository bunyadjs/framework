import { Link } from "@inertiajs/react";
import type { PageMeta } from "~/_types";
import { route } from "~/routes";

/** Shown for a 404. */
export const meta: PageMeta = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-semibold">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-base-content/70">The page you are looking for does not exist.</p>
      <Link href={route("home")} className="btn btn-primary">Back home</Link>
    </main>
  );
}
