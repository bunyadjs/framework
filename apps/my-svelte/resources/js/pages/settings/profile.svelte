<script lang="ts">
  import { route } from "@/routes";
  import { Link, page, useForm } from "@inertiajs/svelte";
  import Field from "@/components/Field.svelte";
  import SettingsLayout from "@/layouts/SettingsLayout.svelte";

  let { mustVerifyEmail }: { mustVerifyEmail: boolean } = $props();
  const user = page.props.auth.user as { name: string; email: string };
  const form = useForm({ name: user.name, email: user.email });

  let confirming = $state(false);
  const deletion = useForm({ password: "" });
  // Deletion errors arrive in the `userDeletion` bag.
  const deletionError = $derived((page.props.errors.userDeletion as { password?: string } | undefined)?.password);

  function save(event: SubmitEvent) {
    event.preventDefault();
    form.patch(route("profile.update"), { preserveScroll: true });
  }

  function closeDeletion() {
    confirming = false;
    deletion.reset();
    deletion.clearErrors();
  }

  function deleteUser(event: SubmitEvent) {
    event.preventDefault();
    deletion.delete(route("profile.destroy"), { preserveScroll: true, onFinish: () => deletion.reset("password") });
  }
</script>

<SettingsLayout title="Profile settings" heading="Profile" subheading="Update your name and email address">
  <form class="flex flex-col gap-4" onsubmit={save}>
    <Field id="name" bind:value={form.name} label="Name" required autocomplete="name" error={form.errors.name} />
    <Field id="email" bind:value={form.email} label="Email" type="email" required autocomplete="email" error={form.errors.email} />

    {#if mustVerifyEmail}
      <p class="text-sm">
        Your email address is unverified.
        <Link href={route("verification.send")} method="post" as="button" class="link">Click here to re-send the verification email.</Link>
        {#if page.props.status === "verification-link-sent"}
          <span class="mt-2 block text-success">A new verification link has been sent to your email address.</span>
        {/if}
      </p>
    {/if}

    <div class="flex items-center gap-4">
      <button type="submit" class="btn btn-primary" disabled={form.processing}>Save</button>
      {#if form.recentlySuccessful}<span class="text-sm text-success">Saved.</span>{/if}
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
      <button type="button" class="btn btn-error btn-sm" onclick={() => (confirming = true)}>Delete account</button>
    </div>

    {#if confirming}
      <div class="modal modal-open" role="dialog">
        <form class="modal-box flex flex-col gap-4" onsubmit={deleteUser}>
          <h3 class="text-lg font-semibold">Are you sure you want to delete your account?</h3>
          <p class="text-sm text-base-content/70">
            Once your account is deleted, all of its resources and data will also be permanently deleted.
            Please enter your password to confirm.
          </p>
          <Field id="delete-password" bind:value={deletion.password} label="Password" type="password" autofocus autocomplete="current-password" placeholder="Password" error={deletionError} />
          <div class="modal-action">
            <button type="button" class="btn" onclick={closeDeletion}>Cancel</button>
            <button type="submit" class="btn btn-error" disabled={deletion.processing}>Delete account</button>
          </div>
        </form>
      </div>
    {/if}
  </div>
</SettingsLayout>
