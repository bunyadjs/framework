<script setup lang="ts">
import { route } from "@/routes";
import { Link, useForm } from "@inertiajs/vue3";
import Field from "@/components/Field.vue";
import AuthLayout from "@/layouts/AuthLayout.vue";

const form = useForm({ name: "", email: "", password: "", password_confirmation: "" });

const submit = () => form.post(route("register.store"), { onFinish: () => form.reset("password", "password_confirmation") });
</script>

<template>
  <AuthLayout title="Create an account" description="Enter your details below to create your account">
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <Field id="name" v-model="form.name" label="Name" required autofocus autocomplete="name" placeholder="Full name" :error="form.errors.name" />
      <Field id="email" v-model="form.email" label="Email address" type="email" required autocomplete="email" placeholder="email@example.com" :error="form.errors.email" />
      <Field id="password" v-model="form.password" label="Password" type="password" required autocomplete="new-password" placeholder="Password" :error="form.errors.password" />
      <Field id="password_confirmation" v-model="form.password_confirmation" label="Confirm password" type="password" required autocomplete="new-password" placeholder="Confirm password" />
      <button type="submit" class="btn btn-primary w-full" :disabled="form.processing">Create account</button>
    </form>
    <p class="text-center text-sm text-base-content/70">
      Already have an account? <Link :href="route('login')" class="link">Log in</Link>
    </p>
  </AuthLayout>
</template>
