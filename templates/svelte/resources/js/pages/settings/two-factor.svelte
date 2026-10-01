<script lang="ts">
  import { route } from "@/routes";
  import { page, router, useForm } from "@inertiajs/svelte";
  import Field from "@/components/Field.svelte";
  import SettingsLayout from "@/layouts/SettingsLayout.svelte";

  type Props = {
    enabled: boolean;
    pending: boolean;
    qrCodeSvg: string | null;
    setupKey: string | null;
    recoveryCodes: string[];
  };
  let { enabled, pending, qrCodeSvg, setupKey, recoveryCodes }: Props = $props();

  const confirm = useForm({ code: "" });
  const options = { preserveScroll: true };

  function submit(event: SubmitEvent) {
    event.preventDefault();
    confirm.post(route("two-factor.confirm"), { ...options, onFinish: () => confirm.reset() });
  }
</script>

<SettingsLayout title="Two-factor authentication" heading="Two-factor authentication" subheading="Manage your two-factor authentication settings">
  {#if enabled}
    <div class="flex flex-col gap-4">
      <div><span class="badge badge-success">Enabled</span></div>
      <p class="text-sm text-base-content/70">
        With two-factor authentication enabled, you will be prompted for a secure, random code during login,
        which you can retrieve from the TOTP-supported application on your phone.
      </p>
      {#if page.props.status === "two-factor-confirmed"}<p class="text-sm text-success">Two-factor authentication is now on.</p>{/if}

      <details class="collapse collapse-arrow border border-base-300 bg-base-100"
        open={page.props.status === "recovery-codes-generated" || page.props.status === "two-factor-confirmed"}>
        <summary class="collapse-title font-medium">Recovery codes</summary>
        <div class="collapse-content flex flex-col gap-3">
          <p class="text-sm text-base-content/70">
            Store these in a password manager. Each one signs you in once if you lose your authenticator device.
          </p>
          <ul class="grid gap-1 rounded-box bg-base-200 p-4 font-mono text-sm">
            {#each recoveryCodes as code (code)}<li>{code}</li>{/each}
          </ul>
          <div>
            <button type="button" class="btn btn-sm" onclick={() => router.post(route("two-factor.recovery-codes"), {}, options)}>Regenerate codes</button>
          </div>
        </div>
      </details>

      <div><button type="button" class="btn btn-error" onclick={() => router.delete(route("two-factor.disable"), options)}>Disable 2FA</button></div>
    </div>
  {:else if pending}
    <div class="flex flex-col gap-4">
      <p class="text-sm text-base-content/70">
        Scan this QR code with your authenticator application, or enter the setup key, then enter the code it shows.
      </p>
      <div class="w-48 rounded-box bg-white p-2">{@html qrCodeSvg}</div>
      <p class="text-sm">Setup key: <code class="font-mono">{setupKey}</code></p>

      <form class="flex flex-col gap-4" onsubmit={submit}>
        <Field id="code" bind:value={confirm.code} label="Code" autofocus inputmode="numeric" autocomplete="one-time-code" maxlength={6} placeholder="123456" inputClass="max-w-xs tracking-widest" error={confirm.errors.code} />
        <div class="flex gap-2">
          <button type="submit" class="btn btn-primary" disabled={confirm.processing}>Confirm</button>
          <button type="button" class="btn btn-ghost" onclick={() => router.delete(route("two-factor.disable"), options)}>Cancel</button>
        </div>
      </form>
    </div>
  {:else}
    <div class="flex flex-col gap-4">
      <div><span class="badge badge-error badge-soft">Disabled</span></div>
      <p class="text-sm text-base-content/70">
        When you enable two-factor authentication, you will be prompted for a secure code during login.
        This code can be retrieved from a TOTP-supported application on your phone.
      </p>
      {#if page.props.status === "two-factor-disabled"}<p class="text-sm text-success">Two-factor authentication is now off.</p>{/if}
      <div><button type="button" class="btn btn-primary" onclick={() => router.post(route("two-factor.enable"), {}, options)}>Enable 2FA</button></div>
    </div>
  {/if}
</SettingsLayout>
