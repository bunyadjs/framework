<script lang="ts">
  import { route } from "@/routes";
  import { useForm } from "@inertiajs/svelte";
  import Field from "@/components/Field.svelte";
  import AuthLayout from "@/layouts/AuthLayout.svelte";

  const form = useForm({ password: "" });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    form.post(route("password.confirm.store"), { onFinish: () => form.reset("password") });
  }
</script>

<AuthLayout title="Confirm your password" description="This is a secure area of the application. Please confirm your password before continuing.">
  <form class="flex flex-col gap-4" onsubmit={submit}>
    <Field id="password" bind:value={form.password} label="Password" type="password" required autofocus autocomplete="current-password" placeholder="Password" error={form.errors.password} />
    <button type="submit" class="btn btn-primary w-full" disabled={form.processing}>Confirm password</button>
  </form>
</AuthLayout>
