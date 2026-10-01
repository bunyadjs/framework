import type { ReactNode } from "react";
import { usePage } from "@inertiajs/react";
import type { SharedProps } from "../types";

type AuthLayoutProps = {
  title: string;
  lede: string;
  children: ReactNode;
};

export default function AuthLayout({ title, lede, children }: AuthLayoutProps) {
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
