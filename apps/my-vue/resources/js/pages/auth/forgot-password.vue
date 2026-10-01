<script setup lang="ts">
import { route } from "@/routes";
import { Link, useForm, usePage } from "@inertiajs/vue3";
import Field from "@/components/Field.vue";
import Status from "@/components/Status.vue";
import AuthLayout from "@/layouts/AuthLayout.vue";
import type { SharedData } from "@/types";

const page = usePage<SharedData>();
const form = useForm({ email: "" });
</script>

<template>
  <AuthLayout title="Forgot password" description="Enter your email to receive a password reset link">
    <Status :message="page.props.status" />
    <form class="flex flex-col gap-4" @submit.prevent="form.post(route('password.email'))">
      <Field id="email" v-model="form.email" label="Email address" type="email" required autofocus placeholder="email@example.com" :error="form.errors.email" />
      <button type="submit" class="btn btn-primary w-full" :disabled="form.processing">Email password reset link</button>
    </form>
    <p class="text-center text-sm text-base-content/70">
      Or, return to <Link :href="route('login')" class="link">log in</Link>
    </p>
  </AuthLayout>
</template>
