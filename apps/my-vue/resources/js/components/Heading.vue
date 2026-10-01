<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="text-center">
    <h1 class="text-xl font-semibold">{{ title }}</h1>
    <p v-if="description" class="mt-1 text-sm text-base-content/70">{{ description }}</p>
  </div>
</template>
