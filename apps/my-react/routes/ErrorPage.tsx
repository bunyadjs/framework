import { Link } from "@inertiajs/react";
import type { PageMeta } from "~/_types";
import { route } from "~/routes";

/** Shown for every error status that has no page of its own (500, 503, …). `status` and `message` are its props. */
export const meta: PageMeta = { title: "Something went wrong" };

export default function ErrorPage({ status, message }: { status: number; message: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-semibold">{status}</p>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-base-content/70">{message || "An error occurred. Please try again."}</p>
      <Link href={route("home")} className="btn btn-primary">Back home</Link>
    </main>
  );
}
