import { Link, useForm } from "@inertiajs/react";
import Field from "@/components/field";
import AuthLayout from "@/layouts/auth-layout";
import { route } from "@/routes";

export default function Register() {
  const form = useForm({ name: "", email: "", password: "", password_confirmation: "" });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    form.post(route("register.store"), { onFinish: () => form.reset("password", "password_confirmation") });
  };

  return (
    <AuthLayout title="Create an account" description="Enter your details below to create your account">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="name" label="Name" required autoFocus autoComplete="name" placeholder="Full name"
          value={form.data.name} onChange={(e) => form.setData("name", e.target.value)} error={form.errors.name} />
        <Field id="email" label="Email address" type="email" required autoComplete="email" placeholder="email@example.com"
          value={form.data.email} onChange={(e) => form.setData("email", e.target.value)} error={form.errors.email} />
        <Field id="password" label="Password" type="password" required autoComplete="new-password" placeholder="Password"
          value={form.data.password} onChange={(e) => form.setData("password", e.target.value)} error={form.errors.password} />
        <Field id="password_confirmation" label="Confirm password" type="password" required autoComplete="new-password" placeholder="Confirm password"
          value={form.data.password_confirmation} onChange={(e) => form.setData("password_confirmation", e.target.value)} />
        <button type="submit" className="btn btn-primary w-full" disabled={form.processing}>Create account</button>
      </form>
      <p className="text-center text-sm text-base-content/70">
        Already have an account? <Link href={route("login")} className="link">Log in</Link>
      </p>
    </AuthLayout>
  );
}
