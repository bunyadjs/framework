<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PageMeta } from "~/_types";

  /**
   * Wraps every page. Put here what every page shares (a toast area, an analytics snippet);
   * the layouts of the folders below nest inside it.
   */
  let { children }: { meta?: PageMeta; children: Snippet } = $props();
</script>

{@render children()}
