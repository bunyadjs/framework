import { Link, useForm, usePage } from "@inertiajs/react";
import Field from "@/components/field";
import Status from "@/components/status";
import AuthLayout from "@/layouts/auth-layout";
import type { SharedData } from "@/types";
import { route } from "@/routes";

export default function ForgotPassword() {
  const { status } = usePage<SharedData>().props;
  const form = useForm({ email: "" });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    form.post(route("password.email"));
  };

  return (
    <AuthLayout title="Forgot password" description="Enter your email to receive a password reset link">
      <Status message={status} />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="email" label="Email address" type="email" required autoFocus placeholder="email@example.com"
          value={form.data.email} onChange={(e) => form.setData("email", e.target.value)} error={form.errors.email} />
        <button type="submit" className="btn btn-primary w-full" disabled={form.processing}>Email password reset link</button>
      </form>
      <p className="text-center text-sm text-base-content/70">
        Or, return to <Link href={route("login")} className="link">log in</Link>
      </p>
    </AuthLayout>
  );
}
