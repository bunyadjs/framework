<script module lang="ts">
  import type { PageMeta } from "~/_types";

  /** The title and text the layout around this page shows. */
  export const meta: PageMeta = { title: "Appearance settings", heading: "Appearance", subheading: "Update the appearance settings for your account" };
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { appearance, loadAppearance, updateAppearance, type Appearance } from "~/_lib/appearance.svelte";

  const modes: Appearance[] = ["light", "dark", "system"];
  onMount(loadAppearance);
</script>

<div class="join" role="radiogroup" aria-label="Appearance">
  {#each modes as mode (mode)}
    <input type="radio" name="appearance" value={mode} class="btn join-item"
      aria-label={mode[0]!.toUpperCase() + mode.slice(1)} checked={appearance.value === mode} onchange={() => updateAppearance(mode)} />
  {/each}
</div>
