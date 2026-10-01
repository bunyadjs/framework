<script setup lang="ts">
import { route } from "@/routes";
import { useForm } from "@inertiajs/vue3";
import Field from "@/components/Field.vue";
import SettingsLayout from "@/layouts/SettingsLayout.vue";

const form = useForm({ current_password: "", password: "", password_confirmation: "" });

const submit = () => form.put(route("password.update"), { preserveScroll: true, onFinish: () => form.reset() });
</script>

<template>
  <SettingsLayout title="Password settings" heading="Update password" subheading="Ensure your account is using a long, random password to stay secure">
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <Field id="current_password" v-model="form.current_password" label="Current password" type="password" required autocomplete="current-password" :error="form.errors.current_password" />
      <Field id="password" v-model="form.password" label="New password" type="password" required autocomplete="new-password" :error="form.errors.password" />
      <Field id="password_confirmation" v-model="form.password_confirmation" label="Confirm password" type="password" required autocomplete="new-password" />
      <div class="flex items-center gap-4">
        <button type="submit" class="btn btn-primary" :disabled="form.processing">Save</button>
        <span v-if="form.recentlySuccessful" class="text-sm text-success">Saved.</span>
      </div>
    </form>
  </SettingsLayout>
</template>
