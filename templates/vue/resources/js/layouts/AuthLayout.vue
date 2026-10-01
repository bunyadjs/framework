<script setup lang="ts">
import { route } from "@/routes";
import { Head, Link } from "@inertiajs/vue3";
import AppLogo from "@/components/AppLogo.vue";
import Heading from "@/components/Heading.vue";

/** A centered card with the logo above it. */
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <main class="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
    <Head :title="title" />
    <Link :href="route('home')" class="text-lg"><AppLogo /></Link>
    <div class="card w-full max-w-sm bg-base-100 shadow-sm">
      <div class="card-body gap-6">
        <Heading :title="title" :description="description" />
        <slot />
      </div>
    </div>
  </main>
</template>
