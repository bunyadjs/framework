<script setup lang="ts">
defineProps<{ message?: string | null }>();
</script>

<template>
  <div v-if="message" role="status" class="alert alert-success alert-soft text-sm">{{ message }}</div>
</template>
