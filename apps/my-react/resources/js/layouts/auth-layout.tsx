import { Head, Link } from "@inertiajs/react";
import type { ReactNode } from "react";
import AppLogo from "@/components/app-logo";
import Heading from "@/components/heading";
import { route } from "@/routes";

type AuthLayoutProps = { title: string; description?: string; children: ReactNode };

/** A centered card with the logo above it. */
export default function AuthLayout({ title, description, children }: AuthLayoutProps) {
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
