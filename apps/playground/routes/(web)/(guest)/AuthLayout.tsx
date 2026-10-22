import type { ReactNode } from "react";
import { usePage } from "@inertiajs/react";
import type { PageMeta, SharedProps } from "~/_types";

/** The brand panel and card around the sign-in pages; the page's `meta` is the card's title and text. */
export default function AuthLayout({ meta, children }: { meta: PageMeta; children: ReactNode }) {
  const { title, description: lede } = meta;
  const { appName } = usePage<SharedProps>().props;

  return (
    <div className="auth-shell">
      <section className="auth-stage" aria-label="Brand">
        <div>
          <h1 className="brand">{appName}</h1>
          <p className="brand-tag">
            Session auth, validation, and Inertia — without leaving the Bun
            runtime.
          </p>
        </div>
        <p className="auth-meta">Built with Bunyad · React · Inertia</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
          {children}
        </div>
      </section>
    </div>
  );
}
