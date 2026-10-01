<script setup lang="ts">
import { route } from "@/routes";
import { Link, useForm, usePage } from "@inertiajs/vue3";
import { ref } from "vue";
import Field from "@/components/Field.vue";
import SettingsLayout from "@/layouts/SettingsLayout.vue";
import type { AuthenticatedData } from "@/types";

defineProps<{ mustVerifyEmail: boolean }>();
const page = usePage<AuthenticatedData>();
const form = useForm({ name: page.props.auth.user.name, email: page.props.auth.user.email });

const confirming = ref(false);
const deletion = useForm({ password: "" });
// Deletion errors arrive in the `userDeletion` bag.
const deletionError = () => (page.props.errors.userDeletion as { password?: string } | undefined)?.password;

const closeDeletion = () => {
  confirming.value = false;
  deletion.reset();
  deletion.clearErrors();
};
const deleteUser = () => deletion.delete(route("profile.destroy"), { preserveScroll: true, onFinish: () => deletion.reset("password") });
</script>

<template>
  <SettingsLayout title="Profile settings" heading="Profile" subheading="Update your name and email address">
    <form class="flex flex-col gap-4" @submit.prevent="form.patch(route('profile.update'), { preserveScroll: true })">
      <Field id="name" v-model="form.name" label="Name" required autocomplete="name" :error="form.errors.name" />
      <Field id="email" v-model="form.email" label="Email" type="email" required autocomplete="email" :error="form.errors.email" />

      <p v-if="mustVerifyEmail" class="text-sm">
        Your email address is unverified.
        <Link :href="route('verification.send')" method="post" as="button" class="link">Click here to re-send the verification email.</Link>
        <span v-if="page.props.status === 'verification-link-sent'" class="mt-2 block text-success">
          A new verification link has been sent to your email address.
        </span>
      </p>

      <div class="flex items-center gap-4">
        <button type="submit" class="btn btn-primary" :disabled="form.processing">Save</button>
        <span v-if="form.recentlySuccessful" class="text-sm text-success">Saved.</span>
      </div>
    </form>

    <div class="mt-12 flex flex-col gap-4">
      <div>
        <h2 class="text-lg font-semibold">Delete account</h2>
        <p class="text-sm text-base-content/70">Delete your account and all of its resources</p>
      </div>
      <div class="alert alert-error alert-soft flex flex-col items-start gap-3">
        <div>
          <p class="font-medium">Warning</p>
          <p class="text-sm">Please proceed with caution, this cannot be undone.</p>
        </div>
        <button type="button" class="btn btn-error btn-sm" @click="confirming = true">Delete account</button>
      </div>

      <div v-if="confirming" class="modal modal-open" role="dialog">
        <form class="modal-box flex flex-col gap-4" @submit.prevent="deleteUser">
          <h3 class="text-lg font-semibold">Are you sure you want to delete your account?</h3>
          <p class="text-sm text-base-content/70">
            Once your account is deleted, all of its resources and data will also be permanently deleted.
            Please enter your password to confirm.
          </p>
          <Field id="delete-password" v-model="deletion.password" label="Password" type="password" autofocus autocomplete="current-password" placeholder="Password" :error="deletionError()" />
          <div class="modal-action">
            <button type="button" class="btn" @click="closeDeletion">Cancel</button>
            <button type="submit" class="btn btn-error" :disabled="deletion.processing">Delete account</button>
          </div>
        </form>
      </div>
    </div>
  </SettingsLayout>
</template>
