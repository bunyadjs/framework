<script module lang="ts">
  import type { PageMeta } from "~/_types";

  /** The title and text the layout around this page shows. */
  export const meta: PageMeta = { title: "Verify email", description: "Please verify your email address by clicking on the link we just emailed to you." };
</script>

<script lang="ts">
  import { route } from "~/routes";
  import { Link, page, useForm } from "@inertiajs/svelte";

  const form = useForm({});
</script>

{#if page.props.status === "verification-link-sent"}
  <div role="status" class="alert alert-success alert-soft text-sm">
    A new verification link has been sent to the email address you provided during registration.
  </div>
{/if}
<button type="button" class="btn btn-primary w-full" disabled={form.processing} onclick={() => form.post(route("email.verification-notification.store"))}>
  Resend verification email
</button>
<Link href={route("logout")} method="post" as="button" class="link text-center text-sm">Log out</Link>
