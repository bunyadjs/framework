<script lang="ts">
import type { PageMeta } from "~/_types";

/** Shown for every error status that has no page of its own (500, 503, …). `status` and `message` are its props. */
export const meta: PageMeta = { title: "Something went wrong" };
</script>

<script setup lang="ts">
import { Link } from "@inertiajs/vue3";
import { route } from "~/routes";

defineProps<{ status: number; message: string }>();
</script>

<template>
  <main class="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
    <p class="text-6xl font-semibold">{{ status }}</p>
    <h1 class="text-xl font-semibold">Something went wrong</h1>
    <p class="text-base-content/70">{{ message || "An error occurred. Please try again." }}</p>
    <Link :href="route('home')" class="btn btn-primary">Back home</Link>
  </main>
</template>
