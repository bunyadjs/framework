<script lang="ts">
import type { PageMeta } from "~/_types";

/** The title and text the layout around this page shows. */
export const meta: PageMeta = { title: "Verify email", description: "Please verify your email address by clicking on the link we just emailed to you." };
</script>

<script setup lang="ts">
import { route } from "~/routes";
import { Link, useForm, usePage } from "@inertiajs/vue3";
import type { SharedData } from "~/_types";

const page = usePage<SharedData>();
const form = useForm({});
</script>

<template>
  <div v-if="page.props.status === 'verification-link-sent'" role="status" class="alert alert-success alert-soft text-sm">
    A new verification link has been sent to the email address you provided during registration.
  </div>
  <button type="button" class="btn btn-primary w-full" :disabled="form.processing" @click="form.post(route('email.verification-notification.store'))">
    Resend verification email
  </button>
  <Link :href="route('logout')" method="post" as="button" class="link text-center text-sm">Log out</Link>
</template>
