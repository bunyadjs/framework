import { router, useForm, usePage } from "@inertiajs/react";
import Field from "@/components/field";
import SettingsLayout from "@/layouts/settings-layout";
import type { SharedData } from "@/types";
import { route } from "@/routes";

type TwoFactorProps = {
  enabled: boolean;
  pending: boolean;
  qrCodeSvg: string | null;
  setupKey: string | null;
  recoveryCodes: string[];
};

export default function TwoFactor({ enabled, pending, qrCodeSvg, setupKey, recoveryCodes }: TwoFactorProps) {
  const { status } = usePage<SharedData>().props;
  const confirm = useForm({ code: "" });
  const options = { preserveScroll: true };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    confirm.post(route("two-factor.confirm"), { ...options, onFinish: () => confirm.reset() });
  };

  return (
    <SettingsLayout title="Two-factor authentication" heading="Two-factor authentication" subheading="Manage your two-factor authentication settings">
      {enabled ? (
        <div className="flex flex-col gap-4">
          <div><span className="badge badge-success">Enabled</span></div>
          <p className="text-sm text-base-content/70">
            With two-factor authentication enabled, you will be prompted for a secure, random code during login,
            which you can retrieve from the TOTP-supported application on your phone.
          </p>
          {status === "two-factor-confirmed" && <p className="text-sm text-success">Two-factor authentication is now on.</p>}

          <details className="collapse collapse-arrow border border-base-300 bg-base-100"
            open={status === "recovery-codes-generated" || status === "two-factor-confirmed"}>
            <summary className="collapse-title font-medium">Recovery codes</summary>
            <div className="collapse-content flex flex-col gap-3">
              <p className="text-sm text-base-content/70">
                Store these in a password manager. Each one signs you in once if you lose your authenticator device.
              </p>
              <ul className="grid gap-1 rounded-box bg-base-200 p-4 font-mono text-sm">
                {recoveryCodes.map((code) => <li key={code}>{code}</li>)}
              </ul>
              <div>
                <button type="button" className="btn btn-sm" onClick={() => router.post(route("two-factor.recovery-codes"), {}, options)}>
                  Regenerate codes
                </button>
              </div>
            </div>
          </details>

          <div>
            <button type="button" className="btn btn-error" onClick={() => router.delete(route("two-factor.disable"), options)}>Disable 2FA</button>
          </div>
        </div>
      ) : pending ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-base-content/70">
            Scan this QR code with your authenticator application, or enter the setup key, then enter the code it shows.
          </p>
          <div className="w-48 rounded-box bg-white p-2" dangerouslySetInnerHTML={{ __html: qrCodeSvg ?? "" }} />
          <p className="text-sm">Setup key: <code className="font-mono">{setupKey}</code></p>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field id="code" label="Code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456"
              className="max-w-xs tracking-widest" value={confirm.data.code} onChange={(e) => confirm.setData("code", e.target.value)}
              error={confirm.errors.code} />
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={confirm.processing}>Confirm</button>
              <button type="button" className="btn btn-ghost" onClick={() => router.delete(route("two-factor.disable"), options)}>Cancel</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div><span className="badge badge-error badge-soft">Disabled</span></div>
          <p className="text-sm text-base-content/70">
            When you enable two-factor authentication, you will be prompted for a secure code during login.
            This code can be retrieved from a TOTP-supported application on your phone.
          </p>
          {status === "two-factor-disabled" && <p className="text-sm text-success">Two-factor authentication is now off.</p>}
          <div>
            <button type="button" className="btn btn-primary" onClick={() => router.post(route("two-factor.enable"), {}, options)}>Enable 2FA</button>
          </div>
        </div>
      )}
    </SettingsLayout>
  );
}
