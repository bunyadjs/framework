<script lang="ts">
  import { route } from "@/routes";
  import { Link, page, useForm } from "@inertiajs/svelte";
  import Field from "@/components/Field.svelte";
  import Status from "@/components/Status.svelte";
  import AuthLayout from "@/layouts/AuthLayout.svelte";

  const form = useForm({ email: "" });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    form.post(route("password.email"));
  }
</script>

<AuthLayout title="Forgot password" description="Enter your email to receive a password reset link">
  <Status message={page.props.status as string | null} />
  <form class="flex flex-col gap-4" onsubmit={submit}>
    <Field id="email" bind:value={form.email} label="Email address" type="email" required autofocus placeholder="email@example.com" error={form.errors.email} />
    <button type="submit" class="btn btn-primary w-full" disabled={form.processing}>Email password reset link</button>
  </form>
  <p class="text-center text-sm text-base-content/70">
    Or, return to <Link href={route("login")} class="link">log in</Link>
  </p>
</AuthLayout>
