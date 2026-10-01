<script setup lang="ts">
import { type Appearance, useAppearance } from "@/composables/useAppearance";
import SettingsLayout from "@/layouts/SettingsLayout.vue";

const modes: Appearance[] = ["light", "dark", "system"];
const { appearance, updateAppearance } = useAppearance();
</script>

<template>
  <SettingsLayout title="Appearance settings" heading="Appearance" subheading="Update the appearance settings for your account">
    <div class="join" role="radiogroup" aria-label="Appearance">
      <input v-for="mode in modes" :key="mode" type="radio" name="appearance" :value="mode" class="btn join-item"
        :aria-label="mode[0]!.toUpperCase() + mode.slice(1)" :checked="appearance === mode" @change="updateAppearance(mode)" />
    </div>
  </SettingsLayout>
</template>
