<script lang="ts">
import type { PageMeta } from "~/_types";

/** The title and text the layout around this page shows. */
export const meta: PageMeta = { title: "Reset password", description: "Please enter your new password below" };
</script>

<script setup lang="ts">
import { route } from "~/routes";
import { useForm } from "@inertiajs/vue3";
import Field from "~/_components/Field.vue";

const props = defineProps<{ token: string; email?: string }>();
const form = useForm({ token: props.token, email: props.email ?? "", password: "", password_confirmation: "" });

const submit = () => form.post(route("password.store"), { onFinish: () => form.reset("password", "password_confirmation") });
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <Field id="email" v-model="form.email" label="Email" type="email" required autocomplete="email" :error="form.errors.email" />
    <Field id="password" v-model="form.password" label="Password" type="password" required autofocus autocomplete="new-password" placeholder="Password" :error="form.errors.password" />
    <Field id="password_confirmation" v-model="form.password_confirmation" label="Confirm password" type="password" required autocomplete="new-password" placeholder="Confirm password" />
    <button type="submit" class="btn btn-primary w-full" :disabled="form.processing">Reset password</button>
  </form>
</template>
