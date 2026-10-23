import { Link, useForm, usePage } from "@inertiajs/react";
import { route } from "~/routes";
import type { PageMeta, SharedData } from "~/_types";

/** The title and text the layout around this page shows. */
export const meta: PageMeta = { title: "Verify email", description: "Please verify your email address by clicking on the link we just emailed to you." };

export default function VerifyEmail() {
  const { status } = usePage<SharedData>().props;
  const form = useForm({});

  return (
    <>
      {status === "verification-link-sent" && (
        <div role="status" className="alert alert-success alert-soft text-sm">
          A new verification link has been sent to the email address you provided during registration.
        </div>
      )}
      <button type="button" className="btn btn-primary w-full" disabled={form.processing}
        onClick={() => form.post(route("email.verification-notification.store"))}>
        Resend verification email
      </button>
      <Link href={route("logout")} method="post" as="button" className="link text-center text-sm">Log out</Link>
    </>
  );
}
