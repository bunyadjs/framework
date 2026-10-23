import { Form, Link, usePage } from "@inertiajs/react";
import type { PageMeta, RegisterPageProps } from "~/_types";

/** The title and text the layout around this page shows. */
export const meta: PageMeta = { title: "Create account", description: "Spin up a playground user and jump into the dashboard." };

export default function Register() {
  const { flash, errors, csrf } = usePage<RegisterPageProps>().props;

  return (
    <>
      {flash.error ? <div className="flash flash-error">{flash.error}</div> : null}

      <Form action="/register" method="post">
        {({ processing }) => (
          <>
            <input type="hidden" name="_token" value={csrf} />
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" type="text" name="name" autoComplete="name" required />
              {errors.name?.[0] ? (
                <span className="error">{errors.name[0]}</span>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                name="email"
                autoComplete="username"
                required
              />
              {errors.email?.[0] ? (
                <span className="error">{errors.email[0]}</span>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                name="password"
                autoComplete="new-password"
                required
              />
              {errors.password?.[0] ? (
                <span className="error">{errors.password[0]}</span>
              ) : null}
            </div>
            <button className="btn" type="submit" disabled={processing}>
              {processing ? "Creating…" : "Create account"}
            </button>
          </>
        )}
      </Form>

      <p className="auth-foot">
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
