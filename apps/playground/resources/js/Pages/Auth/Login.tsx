import { Form, Link, usePage } from "@inertiajs/react";
import AuthLayout from "../../Layouts/AuthLayout";
import type { LoginPageProps } from "../../types";

export default function Login() {
  const { flash, errors, csrf, email } = usePage<LoginPageProps>().props;
  const emailError = errors.email?.[0];
  const passwordError = errors.password?.[0];

  return (
    <AuthLayout
      title="Welcome back"
      lede="Sign in to continue to your playground dashboard."
    >
      {flash.error ? (
        <div className="flash flash-error">{flash.error}</div>
      ) : null}
      {flash.status ? (
        <div className="flash flash-ok">{flash.status}</div>
      ) : null}

      <Form action="/login" method="post">
        {({ processing }) => (
          <>
            <input type="hidden" name="_token" value={csrf} />
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                name="email"
                autoComplete="username"
                defaultValue={email ?? ""}
                required
              />
              {emailError ? <span className="error">{emailError}</span> : null}
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
              {passwordError ? (
                <span className="error">{passwordError}</span>
              ) : null}
            </div>
            <button className="btn" type="submit" disabled={processing}>
              {processing ? "Signing in…" : "Sign in"}
            </button>
          </>
        )}
      </Form>

      <p className="auth-foot">
        New here? <Link href="/register">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
