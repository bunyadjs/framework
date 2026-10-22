<script module lang="ts">
  import type { PageMeta } from "~/_types";

  /** The title and text the layout around this page shows. */
  export const meta: PageMeta = { title: "Confirm your password", description: "This is a secure area of the application. Please confirm your password before continuing." };
</script>

<script lang="ts">
  import { route } from "~/routes";
  import { useForm } from "@inertiajs/svelte";
  import Field from "~/_components/Field.svelte";

  const form = useForm({ password: "" });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    form.post(route("confirm-password.store"), { onFinish: () => form.reset("password") });
  }
</script>

<form class="flex flex-col gap-4" onsubmit={submit}>
  <Field id="password" bind:value={form.password} label="Password" type="password" required autofocus autocomplete="current-password" placeholder="Password" error={form.errors.password} />
  <button type="submit" class="btn btn-primary w-full" disabled={form.processing}>Confirm password</button>
</form>
