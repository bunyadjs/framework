import type { SharedData } from "./shared";

/** Props every page gets, generated from `HandleInertiaRequests.share()` (`bunyad types:generate`). */
export type { SharedData };

export type User = NonNullable<SharedData["auth"]["user"]>;

/** Props on pages behind `auth`. */
export type AuthenticatedData = SharedData & { auth: { user: User } };
