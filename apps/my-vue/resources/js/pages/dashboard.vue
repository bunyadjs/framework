<script setup lang="ts">
import AppLayout from "@/layouts/AppLayout.vue";
</script>

<template>
  <AppLayout title="Dashboard">
    <div class="flex h-full flex-col gap-4">
      <div class="grid gap-4 md:grid-cols-3">
        <div v-for="card in 3" :key="card" class="aspect-video rounded-box border border-dashed border-base-300 bg-base-100" />
      </div>
      <div class="min-h-96 flex-1 rounded-box border border-dashed border-base-300 bg-base-100" />
    </div>
  </AppLayout>
</template>
