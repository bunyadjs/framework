<script setup lang="ts">
import { route } from "@/routes";
import { Link, usePage } from "@inertiajs/vue3";
import AppLayout from "@/layouts/AppLayout.vue";

defineProps<{ title: string; heading: string; subheading: string }>();
const page = usePage();

const sections = [
  { href: route("profile.edit"), label: "Profile" },
  { href: route("password.edit"), label: "Password" },
  { href: route("two-factor.show"), label: "Two-factor auth" },
  { href: route("appearance.edit"), label: "Appearance" },
];
</script>

<template>
  <AppLayout :title="title">
    <div class="mb-8">
      <h1 class="text-2xl font-semibold">Settings</h1>
      <p class="text-base-content/70">Manage your profile and account settings</p>
    </div>

    <div class="flex flex-col gap-8 md:flex-row">
      <ul class="menu w-full shrink-0 p-0 md:w-56">
        <li v-for="section in sections" :key="section.href">
          <Link :href="section.href" prefetch :class="{ 'menu-active': page.url.startsWith(section.href) }">{{ section.label }}</Link>
        </li>
      </ul>

      <section class="w-full max-w-lg">
        <h2 class="text-lg font-semibold">{{ heading }}</h2>
        <p class="mb-6 text-sm text-base-content/70">{{ subheading }}</p>
        <slot />
      </section>
    </div>
  </AppLayout>
</template>
