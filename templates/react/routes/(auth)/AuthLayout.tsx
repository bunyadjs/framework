import { Head, Link } from "@inertiajs/react";
import type { ReactNode } from "react";
import AppLogo from "~/_components/app-logo";
import Heading from "~/_components/heading";
import type { PageMeta } from "~/_types";
import { route } from "~/routes";

/** A centered card with the logo above it. Wraps every page in `(auth)`; the page's `meta` is its title and text. */
export default function AuthLayout({ meta, children }: { meta: PageMeta; children: ReactNode }) {
  const { title, description } = meta;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Head title={title} />
      <Link href={route("home")} className="text-lg"><AppLogo /></Link>
      <div className="card w-full max-w-sm bg-base-100 shadow-sm">
        <div className="card-body gap-6">
          <Heading title={title} description={description} />
          {children}
        </div>
      </div>
    </main>
  );
}
