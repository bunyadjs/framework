<script setup lang="ts">
import { route } from "@/routes";
import { router, useForm, usePage } from "@inertiajs/vue3";
import Field from "@/components/Field.vue";
import SettingsLayout from "@/layouts/SettingsLayout.vue";
import type { SharedData } from "@/types";

defineProps<{
  enabled: boolean;
  pending: boolean;
  qrCodeSvg: string | null;
  setupKey: string | null;
  recoveryCodes: string[];
}>();
const page = usePage<SharedData>();
const confirm = useForm({ code: "" });
const options = { preserveScroll: true };

const submit = () => confirm.post(route("two-factor.confirm"), { ...options, onFinish: () => confirm.reset() });
</script>

<template>
  <SettingsLayout title="Two-factor authentication" heading="Two-factor authentication" subheading="Manage your two-factor authentication settings">
    <div v-if="enabled" class="flex flex-col gap-4">
      <div><span class="badge badge-success">Enabled</span></div>
      <p class="text-sm text-base-content/70">
        With two-factor authentication enabled, you will be prompted for a secure, random code during login,
        which you can retrieve from the TOTP-supported application on your phone.
      </p>
      <p v-if="page.props.status === 'two-factor-confirmed'" class="text-sm text-success">Two-factor authentication is now on.</p>

      <details class="collapse collapse-arrow border border-base-300 bg-base-100"
        :open="page.props.status === 'recovery-codes-generated' || page.props.status === 'two-factor-confirmed'">
        <summary class="collapse-title font-medium">Recovery codes</summary>
        <div class="collapse-content flex flex-col gap-3">
          <p class="text-sm text-base-content/70">
            Store these in a password manager. Each one signs you in once if you lose your authenticator device.
          </p>
          <ul class="grid gap-1 rounded-box bg-base-200 p-4 font-mono text-sm">
            <li v-for="code in recoveryCodes" :key="code">{{ code }}</li>
          </ul>
          <div>
            <button type="button" class="btn btn-sm" @click="router.post(route('two-factor.recovery-codes'), {}, options)">Regenerate codes</button>
          </div>
        </div>
      </details>

      <div><button type="button" class="btn btn-error" @click="router.delete(route('two-factor.disable'), options)">Disable 2FA</button></div>
    </div>

    <div v-else-if="pending" class="flex flex-col gap-4">
      <p class="text-sm text-base-content/70">
        Scan this QR code with your authenticator application, or enter the setup key, then enter the code it shows.
      </p>
      <div class="w-48 rounded-box bg-white p-2" v-html="qrCodeSvg" />
      <p class="text-sm">Setup key: <code class="font-mono">{{ setupKey }}</code></p>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Field id="code" v-model="confirm.code" label="Code" autofocus inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" input-class="max-w-xs tracking-widest" :error="confirm.errors.code" />
        <div class="flex gap-2">
          <button type="submit" class="btn btn-primary" :disabled="confirm.processing">Confirm</button>
          <button type="button" class="btn btn-ghost" @click="router.delete(route('two-factor.disable'), options)">Cancel</button>
        </div>
      </form>
    </div>

    <div v-else class="flex flex-col gap-4">
      <div><span class="badge badge-error badge-soft">Disabled</span></div>
      <p class="text-sm text-base-content/70">
        When you enable two-factor authentication, you will be prompted for a secure code during login.
        This code can be retrieved from a TOTP-supported application on your phone.
      </p>
      <p v-if="page.props.status === 'two-factor-disabled'" class="text-sm text-success">Two-factor authentication is now off.</p>
      <div><button type="button" class="btn btn-primary" @click="router.post(route('two-factor.enable'), {}, options)">Enable 2FA</button></div>
    </div>
  </SettingsLayout>
</template>
