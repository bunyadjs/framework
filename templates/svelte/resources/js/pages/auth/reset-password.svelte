<script lang="ts">
  import { route } from "@/routes";
  import { useForm } from "@inertiajs/svelte";
  import Field from "@/components/Field.svelte";
  import AuthLayout from "@/layouts/AuthLayout.svelte";

  let { token, email }: { token: string; email?: string } = $props();
  const form = useForm({ token, email: email ?? "", password: "", password_confirmation: "" });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    form.post(route("password.store"), { onFinish: () => form.reset("password", "password_confirmation") });
  }
</script>

<AuthLayout title="Reset password" description="Please enter your new password below">
  <form class="flex flex-col gap-4" onsubmit={submit}>
    <Field id="email" bind:value={form.email} label="Email" type="email" required autocomplete="email" error={form.errors.email} />
    <Field id="password" bind:value={form.password} label="Password" type="password" required autofocus autocomplete="new-password" placeholder="Password" error={form.errors.password} />
    <Field id="password_confirmation" bind:value={form.password_confirmation} label="Confirm password" type="password" required autocomplete="new-password" placeholder="Confirm password" />
    <button type="submit" class="btn btn-primary w-full" disabled={form.processing}>Reset password</button>
  </form>
</AuthLayout>
