import { useForm } from "@inertiajs/react";
import Field from "@/components/field";
import AuthLayout from "@/layouts/auth-layout";
import { route } from "@/routes";

export default function ResetPassword({ token, email }: { token: string; email?: string }) {
  const form = useForm({ token, email: email ?? "", password: "", password_confirmation: "" });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    form.post(route("password.store"), { onFinish: () => form.reset("password", "password_confirmation") });
  };

  return (
    <AuthLayout title="Reset password" description="Please enter your new password below">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="email" label="Email" type="email" required autoComplete="email"
          value={form.data.email} onChange={(e) => form.setData("email", e.target.value)} error={form.errors.email} />
        <Field id="password" label="Password" type="password" required autoFocus autoComplete="new-password" placeholder="Password"
          value={form.data.password} onChange={(e) => form.setData("password", e.target.value)} error={form.errors.password} />
        <Field id="password_confirmation" label="Confirm password" type="password" required autoComplete="new-password" placeholder="Confirm password"
          value={form.data.password_confirmation} onChange={(e) => form.setData("password_confirmation", e.target.value)} />
        <button type="submit" className="btn btn-primary w-full" disabled={form.processing}>Reset password</button>
      </form>
    </AuthLayout>
  );
}
