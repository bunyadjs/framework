<script lang="ts">
  import { route } from "@/routes";
  import type { Snippet } from "svelte";
  import { Link, page } from "@inertiajs/svelte";
  import AppLogo from "@/components/AppLogo.svelte";
  import Title from "@/components/Title.svelte";

  /** Sidebar on large screens; a drawer behind the menu button on small ones. */
  let { title, children }: { title: string; children: Snippet } = $props();
  const user = $derived(page.props.auth.user as { name: string; email: string; initials: string });
</script>

<Title {title} />
<div class="drawer lg:drawer-open">
  <input id="sidebar" type="checkbox" class="drawer-toggle" />

  <div class="drawer-content flex min-h-screen flex-col">
    <header class="navbar border-b border-base-300 bg-base-100 lg:hidden">
      <label for="sidebar" class="btn btn-square btn-ghost" aria-label="Open sidebar">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
      </label>
      <Link href={route("dashboard")} class="ml-2"><AppLogo /></Link>
    </header>
    <main class="flex-1 p-6 lg:p-8">{@render children()}</main>
  </div>

  <div class="drawer-side z-20">
    <label for="sidebar" class="drawer-overlay" aria-label="Close sidebar"></label>
    <aside class="flex min-h-full w-64 flex-col border-r border-base-300 bg-base-100 p-4">
      <Link href={route("dashboard")} class="mb-6 px-2"><AppLogo /></Link>

      <ul class="menu w-full p-0">
        <li class="menu-title">Platform</li>
        <li>
          <Link href={route("dashboard")} prefetch class={page.url.startsWith(route("dashboard")) ? "menu-active" : ""}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>
            Dashboard
          </Link>
        </li>
      </ul>

      <div class="dropdown dropdown-top mt-auto w-full">
        <div tabindex="0" role="button" class="btn btn-ghost w-full justify-start gap-3 px-2">
          <div class="avatar avatar-placeholder">
            <div class="w-8 rounded-md bg-neutral text-neutral-content">
              <span class="text-xs">{user.initials}</span>
            </div>
          </div>
          <span class="truncate">{user.name}</span>
        </div>
        <ul tabindex="-1" class="menu dropdown-content z-10 mb-2 w-full rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
          <li class="menu-title truncate">{user.email}</li>
          <li><Link href={route("profile.edit")}>Settings</Link></li>
          <li><Link href={route("logout")} method="post" as="button" class="w-full text-left">Log out</Link></li>
        </ul>
      </div>
    </aside>
  </div>
</div>
