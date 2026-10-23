<script lang="ts">
import type { PageMeta } from "~/_types";

/** The title and text the layout around this page shows. */
export const meta: PageMeta = { title: "Appearance settings", heading: "Appearance", subheading: "Update the appearance settings for your account" };
</script>

<script setup lang="ts">
import { type Appearance, useAppearance } from "~/_composables/useAppearance";

const modes: Appearance[] = ["light", "dark", "system"];
const { appearance, updateAppearance } = useAppearance();
</script>

<template>
  <div class="join" role="radiogroup" aria-label="Appearance">
    <input v-for="mode in modes" :key="mode" type="radio" name="appearance" :value="mode" class="btn join-item"
      :aria-label="mode[0]!.toUpperCase() + mode.slice(1)" :checked="appearance === mode" @change="updateAppearance(mode)" />
  </div>
</template>
