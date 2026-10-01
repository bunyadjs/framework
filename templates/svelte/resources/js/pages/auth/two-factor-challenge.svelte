<script lang="ts">
  import { route } from "@/routes";
  import { useForm } from "@inertiajs/svelte";
  import Field from "@/components/Field.svelte";
  import AuthLayout from "@/layouts/AuthLayout.svelte";

  let usingRecoveryCode = $state(false);
  const form = useForm({ code: "", recovery_code: "" });

  function toggle() {
    usingRecoveryCode = !usingRecoveryCode;
    form.reset();
    form.clearErrors();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    form
      .transform((data) => (usingRecoveryCode ? { recovery_code: data.recovery_code } : { code: data.code }))
      .post(route("two-factor.login.store"));
  }
</script>

<AuthLayout
  title={usingRecoveryCode ? "Recovery code" : "Authentication code"}
  description={usingRecoveryCode
    ? "Please confirm access to your account by entering one of your emergency recovery codes."
    : "Enter the authentication code provided by your authenticator application."}
>
  <form class="flex flex-col gap-4" onsubmit={submit}>
    {#if usingRecoveryCode}
      <Field id="recovery_code" bind:value={form.recovery_code} label="Recovery code" autofocus autocomplete="one-time-code" placeholder="abcdefghij-klmnopqrst" error={form.errors.recovery_code} />
    {:else}
      <Field id="code" bind:value={form.code} label="Code" autofocus inputmode="numeric" autocomplete="one-time-code" maxlength={6} placeholder="123456" inputClass="tracking-widest" error={form.errors.code} />
    {/if}
    <button type="submit" class="btn btn-primary w-full" disabled={form.processing}>Continue</button>
  </form>
  <p class="text-center text-sm text-base-content/70">
    or you can
    <button type="button" class="link" onclick={toggle}>
      {usingRecoveryCode ? "log in using an authentication code" : "log in using a recovery code"}
    </button>
  </p>
</AuthLayout>
