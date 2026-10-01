<script setup lang="ts">
import { route } from "@/routes";
import { Head, Link, usePage } from "@inertiajs/vue3";
import AppLogo from "@/components/AppLogo.vue";
import type { SharedData } from "@/types";

const page = usePage<SharedData>();
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <Head title="Welcome" />
    <header class="navbar mx-auto w-full max-w-5xl px-6">
      <div class="flex-1"><AppLogo /></div>
      <nav class="flex gap-2">
        <Link v-if="page.props.auth.user" :href="route('dashboard')" class="btn btn-sm">Dashboard</Link>
        <template v-else>
          <Link :href="route('login')" class="btn btn-ghost btn-sm">Log in</Link>
          <Link :href="route('register')" class="btn btn-sm">Register</Link>
        </template>
      </nav>
    </header>

    <main class="mx-auto flex w-full max-w-5xl flex-1 items-center px-6">
      <div class="card w-full bg-base-100 shadow-sm">
        <div class="card-body gap-4 lg:p-12">
          <h1 class="text-3xl font-semibold">Let's get started</h1>
          <p class="max-w-xl text-base-content/70">
            Your app is running. Sign up, log in, reset a password, or change your settings
            to try what the starter kit gives you, then build from here.
          </p>
          <div class="card-actions">
            <Link :href="page.props.auth.user ? route('dashboard') : route('register')" class="btn btn-primary">
              {{ page.props.auth.user ? "Go to dashboard" : "Create an account" }}
            </Link>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
