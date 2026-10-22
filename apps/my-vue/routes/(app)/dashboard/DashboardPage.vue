<script lang="ts">
import type { PageMeta } from "~/_types";

/** The title and text the layout around this page shows. */
export const meta: PageMeta = { title: "Dashboard" };
</script>

<script setup lang="ts">
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="grid gap-4 md:grid-cols-3">
      <div v-for="card in 3" :key="card" class="aspect-video rounded-box border border-dashed border-base-300 bg-base-100" />
    </div>
    <div class="min-h-96 flex-1 rounded-box border border-dashed border-base-300 bg-base-100" />
  </div>
</template>
