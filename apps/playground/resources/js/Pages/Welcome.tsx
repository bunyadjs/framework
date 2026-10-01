import { Link, usePage } from "@inertiajs/react";
import type { WelcomePageProps } from "../types";
import { useState } from "react";

export default function Welcome() {
  const { title, message, appName, auth } = usePage<WelcomePageProps>().props;
  const [count, setCount] = useState(0);

  return (
    <div className="dash">
      <header className="dash-nav">
        <div className="mark">{appName}</div>
        {auth.user ? (
          <Link href="/dashboard" className="btn btn-ghost">
            Dashboard
          </Link>
        ) : (
          <Link href="/login" className="btn btn-ghost">
            Sign in
          </Link>
        )}
      </header>
      <main className="dash-main">
        <h1>{title}</h1>
        <p>{message}</p>
        <button onClick={() => setCount(count + 1)}>Click me</button>
        <p>Count: {count}</p>
      </main>
    </div>
  );
}
