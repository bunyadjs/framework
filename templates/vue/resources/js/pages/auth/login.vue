<script setup lang="ts">
import { route } from "@/routes";
import { Link, useForm, usePage } from "@inertiajs/vue3";
import Field from "@/components/Field.vue";
import Status from "@/components/Status.vue";
import AuthLayout from "@/layouts/AuthLayout.vue";
import type { SharedData } from "@/types";

const page = usePage<SharedData>();
const form = useForm({ email: "", password: "", remember: false });

const submit = () => form.post(route("login.store"), { onFinish: () => form.reset("password") });
</script>

<template>
  <AuthLayout title="Log in to your account" description="Enter your email and password below to log in">
    <Status :message="page.props.status" />
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <Field id="email" v-model="form.email" label="Email address" type="email" required autofocus autocomplete="email" placeholder="email@example.com" :error="form.errors.email" />
      <Field id="password" v-model="form.password" label="Password" type="password" required autocomplete="current-password" placeholder="Password" :error="form.errors.password">
        <template #aside><Link :href="route('password.request')" class="link link-hover text-sm">Forgot your password?</Link></template>
      </Field>
      <label class="label">
        <input v-model="form.remember" type="checkbox" class="checkbox checkbox-sm" />
        Remember me
      </label>
      <button type="submit" class="btn btn-primary w-full" :disabled="form.processing">Log in</button>
    </form>
    <p class="text-center text-sm text-base-content/70">
      Don't have an account? <Link :href="route('register')" class="link">Sign up</Link>
    </p>
  </AuthLayout>
</template>
