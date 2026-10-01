import { Link, useForm, usePage } from "@inertiajs/react";
import { useState } from "react";
import Field from "@/components/field";
import SettingsLayout from "@/layouts/settings-layout";
import type { AuthenticatedData } from "@/types";
import { route } from "@/routes";

export default function Profile({ mustVerifyEmail }: { mustVerifyEmail: boolean }) {
  const { auth, status } = usePage<AuthenticatedData>().props;
  const form = useForm({ name: auth.user.name, email: auth.user.email });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    form.patch(route("profile.update"), { preserveScroll: true });
  };

  return (
    <SettingsLayout title="Profile settings" heading="Profile" subheading="Update your name and email address">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="name" label="Name" required autoComplete="name"
          value={form.data.name} onChange={(e) => form.setData("name", e.target.value)} error={form.errors.name} />
        <Field id="email" label="Email" type="email" required autoComplete="email"
          value={form.data.email} onChange={(e) => form.setData("email", e.target.value)} error={form.errors.email} />

        {mustVerifyEmail && (
          <p className="text-sm">
            Your email address is unverified.{" "}
            <Link href={route("verification.send")} method="post" as="button" className="link">
              Click here to re-send the verification email.
            </Link>
            {status === "verification-link-sent" && (
              <span className="mt-2 block text-success">A new verification link has been sent to your email address.</span>
            )}
          </p>
        )}

        <div className="flex items-center gap-4">
          <button type="submit" className="btn btn-primary" disabled={form.processing}>Save</button>
          {form.recentlySuccessful && <span className="text-sm text-success">Saved.</span>}
        </div>
      </form>

      <DeleteUser />
    </SettingsLayout>
  );
}

function DeleteUser() {
  const [confirming, setConfirming] = useState(false);
  const form = useForm({ password: "" });
  const error = (form.errors as Record<string, unknown> & { userDeletion?: { password?: string } }).userDeletion?.password;

  const close = () => {
    setConfirming(false);
    form.reset();
    form.clearErrors();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    form.delete(route("profile.destroy"), { preserveScroll: true, onFinish: () => form.reset("password") });
  };

  return (
    <div className="mt-12 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Delete account</h2>
        <p className="text-sm text-base-content/70">Delete your account and all of its resources</p>
      </div>
      <div className="alert alert-error alert-soft flex flex-col items-start gap-3">
        <div>
          <p className="font-medium">Warning</p>
          <p className="text-sm">Please proceed with caution, this cannot be undone.</p>
        </div>
        <button type="button" className="btn btn-error btn-sm" onClick={() => setConfirming(true)}>Delete account</button>
      </div>

      {confirming && (
        <div className="modal modal-open" role="dialog">
          <form onSubmit={submit} className="modal-box flex flex-col gap-4">
            <h3 className="text-lg font-semibold">Are you sure you want to delete your account?</h3>
            <p className="text-sm text-base-content/70">
              Once your account is deleted, all of its resources and data will also be permanently deleted.
              Please enter your password to confirm.
            </p>
            <Field id="delete-password" label="Password" type="password" autoFocus autoComplete="current-password" placeholder="Password"
              value={form.data.password} onChange={(e) => form.setData("password", e.target.value)} error={error} />
            <div className="modal-action">
              <button type="button" className="btn" onClick={close}>Cancel</button>
              <button type="submit" className="btn btn-error" disabled={form.processing}>Delete account</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
