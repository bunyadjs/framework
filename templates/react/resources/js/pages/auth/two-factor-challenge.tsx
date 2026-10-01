import { useForm } from "@inertiajs/react";
import { useState } from "react";
import Field from "@/components/field";
import AuthLayout from "@/layouts/auth-layout";
import { route } from "@/routes";

export default function TwoFactorChallenge() {
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  const form = useForm({ code: "", recovery_code: "" });

  const toggle = () => {
    setUsingRecoveryCode(!usingRecoveryCode);
    form.reset();
    form.clearErrors();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    form.transform((data) => (usingRecoveryCode ? { recovery_code: data.recovery_code } : { code: data.code }));
    form.post(route("two-factor.login.store"));
  };

  return (
    <AuthLayout
      title={usingRecoveryCode ? "Recovery code" : "Authentication code"}
      description={usingRecoveryCode
        ? "Please confirm access to your account by entering one of your emergency recovery codes."
        : "Enter the authentication code provided by your authenticator application."}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {usingRecoveryCode ? (
          <Field id="recovery_code" label="Recovery code" autoFocus autoComplete="one-time-code" placeholder="abcdefghij-klmnopqrst"
            value={form.data.recovery_code} onChange={(e) => form.setData("recovery_code", e.target.value)} error={form.errors.recovery_code} />
        ) : (
          <Field id="code" label="Code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className="tracking-widest"
            value={form.data.code} onChange={(e) => form.setData("code", e.target.value)} error={form.errors.code} />
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={form.processing}>Continue</button>
      </form>
      <p className="text-center text-sm text-base-content/70">
        or you can{" "}
        <button type="button" className="link" onClick={toggle}>
          {usingRecoveryCode ? "log in using an authentication code" : "log in using a recovery code"}
        </button>
      </p>
    </AuthLayout>
  );
}
