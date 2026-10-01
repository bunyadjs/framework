import { Form, Link, usePage } from "@inertiajs/react";
import type { DashboardPageProps } from "../../types";

export default function Dashboard() {
  const { name, csrf, appName } = usePage<DashboardPageProps>().props;

  return (
    <div className="dash">
      <header className="dash-nav">
        <div className="mark">{appName}</div>
        <Form action="/logout" method="post">
          {({ processing }) => (
            <>
              <input type="hidden" name="_token" value={csrf} />
              <button
                className="btn btn-ghost"
                type="submit"
                disabled={processing}
              >
                Log out
              </button>
            </>
          )}
        </Form>
      </header>
      <main className="dash-main">
        <h1>Hello, {name}.</h1>
        <p>
          You are signed in through session auth. This page is an Inertia React
          screen — forms post without a full document reload.
        </p>
        <div className="dash-actions">
          <Link href="/notes" className="btn">
            Notes
          </Link>
          <Link href="/inertia" className="btn">
            Inertia demo
          </Link>
          <Link href="/welcome" className="btn btn-ghost">
            Classic welcome
          </Link>
        </div>
      </main>
    </div>
  );
}
