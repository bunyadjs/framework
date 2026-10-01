<script lang="ts">
  import { route } from "@/routes";
  import { Link, page, useForm } from "@inertiajs/svelte";
  import Field from "@/components/Field.svelte";
  import Status from "@/components/Status.svelte";
  import AuthLayout from "@/layouts/AuthLayout.svelte";

  const form = useForm({ email: "", password: "", remember: false });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    form.post(route("login.store"), { onFinish: () => form.reset("password") });
  }
</script>

<AuthLayout title="Log in to your account" description="Enter your email and password below to log in">
  <Status message={page.props.status as string | null} />
  <form class="flex flex-col gap-4" onsubmit={submit}>
    <Field id="email" bind:value={form.email} label="Email address" type="email" required autofocus autocomplete="email" placeholder="email@example.com" error={form.errors.email} />
    <Field id="password" bind:value={form.password} label="Password" type="password" required autocomplete="current-password" placeholder="Password" error={form.errors.password}>
      {#snippet aside()}<Link href={route("password.request")} class="link link-hover text-sm">Forgot your password?</Link>{/snippet}
    </Field>
    <label class="label">
      <input type="checkbox" class="checkbox checkbox-sm" bind:checked={form.remember} />
      Remember me
    </label>
    <button type="submit" class="btn btn-primary w-full" disabled={form.processing}>Log in</button>
  </form>
  <p class="text-center text-sm text-base-content/70">
    Don't have an account? <Link href={route("register")} class="link">Sign up</Link>
  </p>
</AuthLayout>
