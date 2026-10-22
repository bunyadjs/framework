<script module lang="ts">
  import type { PageMeta } from "~/_types";

  /** The title and text the layout around this page shows. */
  export const meta: PageMeta = { title: "Forgot password", description: "Enter your email to receive a password reset link" };
</script>

<script lang="ts">
  import { route } from "~/routes";
  import { Link, page, useForm } from "@inertiajs/svelte";
  import Field from "~/_components/Field.svelte";
  import Status from "~/_components/Status.svelte";

  const form = useForm({ email: "" });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    form.post(route("forgot-password.store"));
  }
</script>

<Status message={page.props.status as string | null} />
<form class="flex flex-col gap-4" onsubmit={submit}>
  <Field id="email" bind:value={form.email} label="Email address" type="email" required autofocus placeholder="email@example.com" error={form.errors.email} />
  <button type="submit" class="btn btn-primary w-full" disabled={form.processing}>Email password reset link</button>
</form>
<p class="text-center text-sm text-base-content/70">
  Or, return to <Link href={route("login")} class="link">log in</Link>
</p>
