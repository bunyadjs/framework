<script setup lang="ts">
import { route } from "@/routes";
import { useForm } from "@inertiajs/vue3";
import Field from "@/components/Field.vue";
import AuthLayout from "@/layouts/AuthLayout.vue";

const form = useForm({ password: "" });

const submit = () => form.post(route("password.confirm.store"), { onFinish: () => form.reset("password") });
</script>

<template>
  <AuthLayout title="Confirm your password" description="This is a secure area of the application. Please confirm your password before continuing.">
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <Field id="password" v-model="form.password" label="Password" type="password" required autofocus autocomplete="current-password" placeholder="Password" :error="form.errors.password" />
      <button type="submit" class="btn btn-primary w-full" :disabled="form.processing">Confirm password</button>
    </form>
  </AuthLayout>
</template>
