import type { SharedData } from "../.bunyad/shared";

/** Props every page gets, generated from `HandleInertiaRequests.share()` (`bunyad types:generate`). */
export type { SharedData };

export type User = NonNullable<SharedData["auth"]["user"]>;

/** Props on pages behind `auth`. */
export type AuthenticatedData = SharedData & { auth: { user: User } };

/** What a page tells the layouts around it: `export const meta = { title: "…" }`. */
export type PageMeta = { title: string; description?: string; heading?: string; subheading?: string };
