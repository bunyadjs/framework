<script module lang="ts">
  import type { PageMeta } from "~/_types";

  /** Shown for a 404. */
  export const meta: PageMeta = { title: "Page not found" };
</script>

<script lang="ts">
  import { Link } from "@inertiajs/svelte";
  import { route } from "~/routes";
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
  <p class="text-6xl font-semibold">404</p>
  <h1 class="text-xl font-semibold">Page not found</h1>
  <p class="text-base-content/70">The page you are looking for does not exist.</p>
  <Link href={route("home")} class="btn btn-primary">Back home</Link>
</main>
