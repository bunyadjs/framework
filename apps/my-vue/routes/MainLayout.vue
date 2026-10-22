<script setup lang="ts">
import type { PageMeta } from "~/_types";

/**
 * Wraps every page. Put here what every page shares (a toast area, an analytics snippet);
 * the layouts of the folders below nest inside it.
 */
defineProps<{ meta?: PageMeta }>();
</script>

<template>
  <slot />
</template>
