import { useForm } from "@inertiajs/react";
import Field from "~/_components/field";
import { route } from "~/routes";
import type { PageMeta } from "~/_types";

/** The title and text the layout around this page shows. */
export const meta: PageMeta = { title: "Confirm your password", description: "This is a secure area of the application. Please confirm your password before continuing." };

export default function ConfirmPassword() {
  const form = useForm({ password: "" });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    form.post(route("confirm-password.store"), { onFinish: () => form.reset("password") });
  };

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="password" label="Password" type="password" required autoFocus autoComplete="current-password" placeholder="Password"
          value={form.data.password} onChange={(e) => form.setData("password", e.target.value)} error={form.errors.password} />
        <button type="submit" className="btn btn-primary w-full" disabled={form.processing}>Confirm password</button>
      </form>
    </>
  );
}
