<script lang="ts">
  import { route } from "@/routes";
  import type { Snippet } from "svelte";
  import { Link, page } from "@inertiajs/svelte";
  import AppLayout from "@/layouts/AppLayout.svelte";

  let { title, heading, subheading, children }: { title: string; heading: string; subheading: string; children: Snippet } = $props();

  const sections = [
    { href: route("profile.edit"), label: "Profile" },
    { href: route("password.edit"), label: "Password" },
    { href: route("two-factor.show"), label: "Two-factor auth" },
    { href: route("appearance.edit"), label: "Appearance" },
  ];
</script>

<AppLayout {title}>
  <div class="mb-8">
    <h1 class="text-2xl font-semibold">Settings</h1>
    <p class="text-base-content/70">Manage your profile and account settings</p>
  </div>

  <div class="flex flex-col gap-8 md:flex-row">
    <ul class="menu w-full shrink-0 p-0 md:w-56">
      {#each sections as section (section.href)}
        <li>
          <Link href={section.href} prefetch class={page.url.startsWith(section.href) ? "menu-active" : ""}>{section.label}</Link>
        </li>
      {/each}
    </ul>

    <section class="w-full max-w-lg">
      <h2 class="text-lg font-semibold">{heading}</h2>
      <p class="mb-6 text-sm text-base-content/70">{subheading}</p>
      {@render children()}
    </section>
  </div>
</AppLayout>
