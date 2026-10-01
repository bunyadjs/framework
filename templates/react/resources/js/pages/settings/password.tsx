import { useForm } from "@inertiajs/react";
import Field from "@/components/field";
import SettingsLayout from "@/layouts/settings-layout";
import { route } from "@/routes";

export default function Password() {
  const form = useForm({ current_password: "", password: "", password_confirmation: "" });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    form.put(route("password.update"), {
      preserveScroll: true,
      onFinish: () => form.reset(),
    });
  };

  return (
    <SettingsLayout title="Password settings" heading="Update password" subheading="Ensure your account is using a long, random password to stay secure">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="current_password" label="Current password" type="password" required autoComplete="current-password"
          value={form.data.current_password} onChange={(e) => form.setData("current_password", e.target.value)} error={form.errors.current_password} />
        <Field id="password" label="New password" type="password" required autoComplete="new-password"
          value={form.data.password} onChange={(e) => form.setData("password", e.target.value)} error={form.errors.password} />
        <Field id="password_confirmation" label="Confirm password" type="password" required autoComplete="new-password"
          value={form.data.password_confirmation} onChange={(e) => form.setData("password_confirmation", e.target.value)} />
        <div className="flex items-center gap-4">
          <button type="submit" className="btn btn-primary" disabled={form.processing}>Save</button>
          {form.recentlySuccessful && <span className="text-sm text-success">Saved.</span>}
        </div>
      </form>
    </SettingsLayout>
  );
}
