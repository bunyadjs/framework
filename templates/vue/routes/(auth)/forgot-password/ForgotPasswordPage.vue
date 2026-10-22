<script lang="ts">
import type { PageMeta } from "~/_types";

/** The title and text the layout around this page shows. */
export const meta: PageMeta = { title: "Forgot password", description: "Enter your email to receive a password reset link" };
</script>

<script setup lang="ts">
import { route } from "~/routes";
import { Link, useForm, usePage } from "@inertiajs/vue3";
import Field from "~/_components/Field.vue";
import Status from "~/_components/Status.vue";
import type { SharedData } from "~/_types";

const page = usePage<SharedData>();
const form = useForm({ email: "" });
</script>

<template>
  <Status :message="page.props.status" />
  <form class="flex flex-col gap-4" @submit.prevent="form.post(route('forgot-password.store'))">
    <Field id="email" v-model="form.email" label="Email address" type="email" required autofocus placeholder="email@example.com" :error="form.errors.email" />
    <button type="submit" class="btn btn-primary w-full" :disabled="form.processing">Email password reset link</button>
  </form>
  <p class="text-center text-sm text-base-content/70">
    Or, return to <Link :href="route('login')" class="link">log in</Link>
  </p>
</template>
