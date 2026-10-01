import { useForm } from "@inertiajs/react";
import Field from "@/components/field";
import AuthLayout from "@/layouts/auth-layout";
import { route } from "@/routes";

export default function ConfirmPassword() {
  const form = useForm({ password: "" });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    form.post(route("password.confirm.store"), { onFinish: () => form.reset("password") });
  };

  return (
    <AuthLayout title="Confirm your password" description="This is a secure area of the application. Please confirm your password before continuing.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="password" label="Password" type="password" required autoFocus autoComplete="current-password" placeholder="Password"
          value={form.data.password} onChange={(e) => form.setData("password", e.target.value)} error={form.errors.password} />
        <button type="submit" className="btn btn-primary w-full" disabled={form.processing}>Confirm password</button>
      </form>
    </AuthLayout>
  );
}
