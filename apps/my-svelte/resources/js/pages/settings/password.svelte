<script lang="ts">
  import { route } from "@/routes";
  import { useForm } from "@inertiajs/svelte";
  import Field from "@/components/Field.svelte";
  import SettingsLayout from "@/layouts/SettingsLayout.svelte";

  const form = useForm({ current_password: "", password: "", password_confirmation: "" });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    form.put(route("password.update"), { preserveScroll: true, onFinish: () => form.reset() });
  }
</script>

<SettingsLayout title="Password settings" heading="Update password" subheading="Ensure your account is using a long, random password to stay secure">
  <form class="flex flex-col gap-4" onsubmit={submit}>
    <Field id="current_password" bind:value={form.current_password} label="Current password" type="password" required autocomplete="current-password" error={form.errors.current_password} />
    <Field id="password" bind:value={form.password} label="New password" type="password" required autocomplete="new-password" error={form.errors.password} />
    <Field id="password_confirmation" bind:value={form.password_confirmation} label="Confirm password" type="password" required autocomplete="new-password" />
    <div class="flex items-center gap-4">
      <button type="submit" class="btn btn-primary" disabled={form.processing}>Save</button>
      {#if form.recentlySuccessful}<span class="text-sm text-success">Saved.</span>{/if}
    </div>
  </form>
</SettingsLayout>
