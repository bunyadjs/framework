<script lang="ts">
  import { route } from "@/routes";
  import type { Snippet } from "svelte";
  import { Link } from "@inertiajs/svelte";
  import AppLogo from "@/components/AppLogo.svelte";
  import Heading from "@/components/Heading.svelte";
  import Title from "@/components/Title.svelte";

  /** A centered card with the logo above it. */
  let { title, description, children }: { title: string; description?: string; children: Snippet } = $props();
</script>

<Title {title} />
<main class="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
  <Link href={route("home")} class="text-lg"><AppLogo /></Link>
  <div class="card w-full max-w-sm bg-base-100 shadow-sm">
    <div class="card-body gap-6">
      <Heading {title} {description} />
      {@render children()}
    </div>
  </div>
</main>
