<script setup lang="ts">
defineProps<{ message?: string }>();
</script>

<template>
  <p v-if="message" class="text-sm text-error">{{ message }}</p>
</template>
