import { Link, usePage } from "@inertiajs/react";
import type { ReactNode } from "react";
import type { PageMeta } from "~/_types";
import { route } from "~/routes";

const sections = [
  { href: route("settings.profile"), label: "Profile" },
  { href: route("settings.password"), label: "Password" },
  { href: route("two-factor.show"), label: "Two-factor auth" },
  { href: route("settings.appearance"), label: "Appearance" },
];

/** The settings menu and heading, inside the app layout. Wraps every page in `settings`. */
export default function SettingsLayout({ meta, children }: { meta: PageMeta; children: ReactNode }) {
  const { heading, subheading } = meta;
  const { url } = usePage();

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-base-content/70">Manage your profile and account settings</p>
      </div>

      <div className="flex flex-col gap-8 md:flex-row">
        <ul className="menu w-full shrink-0 p-0 md:w-56">
          {sections.map((section) => (
            <li key={section.href}>
              <Link href={section.href} prefetch className={url.startsWith(section.href) ? "menu-active" : ""}>
                {section.label}
              </Link>
            </li>
          ))}
        </ul>

        <section className="w-full max-w-lg">
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="mb-6 text-sm text-base-content/70">{subheading}</p>
          {children}
        </section>
      </div>
    </>
  );
}
