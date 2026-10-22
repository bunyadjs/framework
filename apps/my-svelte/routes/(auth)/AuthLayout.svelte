<script lang="ts">
  import { route } from "~/routes";
  import type { Snippet } from "svelte";
  import { Link } from "@inertiajs/svelte";
  import AppLogo from "~/_components/AppLogo.svelte";
  import Heading from "~/_components/Heading.svelte";
  import Title from "~/_components/Title.svelte";
  import type { PageMeta } from "~/_types";

  /** A centered card with the logo above it. Wraps every page in `(auth)`; the page's `meta` is its title and text. */
  let { meta, children }: { meta: PageMeta; children: Snippet } = $props();
</script>

<Title title={meta.title} />
<main class="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
  <Link href={route("home")} class="text-lg"><AppLogo /></Link>
  <div class="card w-full max-w-sm bg-base-100 shadow-sm">
    <div class="card-body gap-6">
      <Heading title={meta.title} description={meta.description} />
      {@render children()}
    </div>
  </div>
</main>
