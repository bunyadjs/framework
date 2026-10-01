import { Link, useForm, usePage } from "@inertiajs/react";
import Field from "@/components/field";
import Status from "@/components/status";
import AuthLayout from "@/layouts/auth-layout";
import type { SharedData } from "@/types";
import { route } from "@/routes";

export default function Login() {
  const { status } = usePage<SharedData>().props;
  const form = useForm({ email: "", password: "", remember: false });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    form.post(route("login.store"), { onFinish: () => form.reset("password") });
  };

  return (
    <AuthLayout title="Log in to your account" description="Enter your email and password below to log in">
      <Status message={status} />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="email" label="Email address" type="email" required autoFocus autoComplete="email" placeholder="email@example.com"
          value={form.data.email} onChange={(e) => form.setData("email", e.target.value)} error={form.errors.email} />
        <Field id="password" label="Password" type="password" required autoComplete="current-password" placeholder="Password"
          value={form.data.password} onChange={(e) => form.setData("password", e.target.value)} error={form.errors.password}
          aside={<Link href={route("password.request")} className="link link-hover text-sm">Forgot your password?</Link>} />
        <label className="label">
          <input type="checkbox" className="checkbox checkbox-sm" checked={form.data.remember}
            onChange={(e) => form.setData("remember", e.target.checked)} />
          Remember me
        </label>
        <button type="submit" className="btn btn-primary w-full" disabled={form.processing}>Log in</button>
      </form>
      <p className="text-center text-sm text-base-content/70">
        Don't have an account? <Link href={route("register")} className="link">Sign up</Link>
      </p>
    </AuthLayout>
  );
}
