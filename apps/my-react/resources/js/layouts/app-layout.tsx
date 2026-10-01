import { Head, Link, usePage } from "@inertiajs/react";
import type { ReactNode } from "react";
import AppLogo from "@/components/app-logo";
import type { AuthenticatedData } from "@/types";
import { route } from "@/routes";

/** Sidebar on large screens; a drawer behind the menu button on small ones. */
export default function AppLayout({ title, children }: { title: string; children: ReactNode }) {
  const { props, url } = usePage<AuthenticatedData>();
  const { auth } = props;

  return (
    <div className="drawer lg:drawer-open">
      <Head title={title} />
      <input id="sidebar" type="checkbox" className="drawer-toggle" />

      <div className="drawer-content flex min-h-screen flex-col">
        <header className="navbar border-b border-base-300 bg-base-100 lg:hidden">
          <label htmlFor="sidebar" className="btn btn-square btn-ghost" aria-label="Open sidebar">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
          </label>
          <Link href={route("dashboard")} className="ml-2"><AppLogo /></Link>
        </header>
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>

      <div className="drawer-side z-20">
        <label htmlFor="sidebar" className="drawer-overlay" aria-label="Close sidebar" />
        <aside className="flex min-h-full w-64 flex-col border-r border-base-300 bg-base-100 p-4">
          <Link href={route("dashboard")} className="mb-6 px-2"><AppLogo /></Link>

          <ul className="menu w-full p-0">
            <li className="menu-title">Platform</li>
            <li>
              <Link href={route("dashboard")} prefetch className={url.startsWith(route("dashboard")) ? "menu-active" : ""}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>
                Dashboard
              </Link>
            </li>
          </ul>

          <div className="dropdown dropdown-top mt-auto w-full">
            <div tabIndex={0} role="button" className="btn btn-ghost w-full justify-start gap-3 px-2">
              <div className="avatar avatar-placeholder">
                <div className="w-8 rounded-md bg-neutral text-neutral-content">
                  <span className="text-xs">{auth.user.initials}</span>
                </div>
              </div>
              <span className="truncate">{auth.user.name}</span>
            </div>
            <ul tabIndex={0} className="menu dropdown-content z-10 mb-2 w-full rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
              <li className="menu-title truncate">{auth.user.email}</li>
              <li><Link href={route("profile.edit")}>Settings</Link></li>
              <li><Link href={route("logout")} method="post" as="button" className="w-full text-left">Log out</Link></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
