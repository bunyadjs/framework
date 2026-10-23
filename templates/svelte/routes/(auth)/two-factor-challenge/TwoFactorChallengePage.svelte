<script module lang="ts">
  import type { PageMeta } from "~/_types";

  /** The title and text the layout around this page shows. */
  export const meta: PageMeta = { title: "Two-factor authentication", description: "Confirm access to your account with a code from your authenticator app, or one of your recovery codes." };
</script>

<script lang="ts">
  import { route } from "~/routes";
  import { useForm } from "@inertiajs/svelte";
  import Field from "~/_components/Field.svelte";

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
      .post(route("two-factor-challenge.store"));
  }
</script>

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
