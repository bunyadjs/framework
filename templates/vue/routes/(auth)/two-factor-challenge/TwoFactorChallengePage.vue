<script lang="ts">
import type { PageMeta } from "~/_types";

/** The title and text the layout around this page shows. */
export const meta: PageMeta = { title: "Two-factor authentication", description: "Confirm access to your account with a code from your authenticator app, or one of your recovery codes." };
</script>

<script setup lang="ts">
import { route } from "~/routes";
import { useForm } from "@inertiajs/vue3";
import { ref } from "vue";
import Field from "~/_components/Field.vue";

const usingRecoveryCode = ref(false);
const form = useForm({ code: "", recovery_code: "" });

const toggle = () => {
  usingRecoveryCode.value = !usingRecoveryCode.value;
  form.reset();
  form.clearErrors();
};

const submit = () =>
  form
    .transform((data) => (usingRecoveryCode.value ? { recovery_code: data.recovery_code } : { code: data.code }))
    .post(route("two-factor-challenge.store"));
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <Field v-if="usingRecoveryCode" id="recovery_code" v-model="form.recovery_code" label="Recovery code" autofocus autocomplete="one-time-code" placeholder="abcdefghij-klmnopqrst" :error="form.errors.recovery_code" />
    <Field v-else id="code" v-model="form.code" label="Code" autofocus inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" input-class="tracking-widest" :error="form.errors.code" />
    <button type="submit" class="btn btn-primary w-full" :disabled="form.processing">Continue</button>
  </form>
  <p class="text-center text-sm text-base-content/70">
    or you can
    <button type="button" class="link" @click="toggle">
      {{ usingRecoveryCode ? "log in using an authentication code" : "log in using a recovery code" }}
    </button>
  </p>
</template>
