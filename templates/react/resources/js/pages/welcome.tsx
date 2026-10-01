import { Head, Link, usePage } from "@inertiajs/react";
import AppLogo from "@/components/app-logo";
import type { SharedData } from "@/types";
import { route } from "@/routes";

export default function Welcome() {
  const { auth } = usePage<SharedData>().props;

  return (
    <div className="flex min-h-screen flex-col">
      <Head title="Welcome" />
      <header className="navbar mx-auto w-full max-w-5xl px-6">
        <div className="flex-1"><AppLogo /></div>
        <nav className="flex gap-2">
          {auth.user ? (
            <Link href={route("dashboard")} className="btn btn-sm">Dashboard</Link>
          ) : (
            <>
              <Link href={route("login")} className="btn btn-ghost btn-sm">Log in</Link>
              <Link href={route("register")} className="btn btn-sm">Register</Link>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-6">
        <div className="card w-full bg-base-100 shadow-sm">
          <div className="card-body gap-4 lg:p-12">
            <h1 className="text-3xl font-semibold">Let's get started</h1>
            <p className="max-w-xl text-base-content/70">
              Your app is running. Sign up, log in, reset a password, or change your settings
              to try what the starter kit gives you, then build from here.
            </p>
            <div className="card-actions">
              <Link href={auth.user ? route("dashboard") : route("register")} className="btn btn-primary">
                {auth.user ? "Go to dashboard" : "Create an account"}
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
