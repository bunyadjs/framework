<script lang="ts">
  import { onMount } from "svelte";
  import { appearance, loadAppearance, updateAppearance, type Appearance } from "@/lib/appearance.svelte";
  import SettingsLayout from "@/layouts/SettingsLayout.svelte";

  const modes: Appearance[] = ["light", "dark", "system"];
  onMount(loadAppearance);
</script>

<SettingsLayout title="Appearance settings" heading="Appearance" subheading="Update the appearance settings for your account">
  <div class="join" role="radiogroup" aria-label="Appearance">
    {#each modes as mode (mode)}
      <input type="radio" name="appearance" value={mode} class="btn join-item"
        aria-label={mode[0]!.toUpperCase() + mode.slice(1)} checked={appearance.value === mode} onchange={() => updateAppearance(mode)} />
    {/each}
  </div>
</SettingsLayout>
