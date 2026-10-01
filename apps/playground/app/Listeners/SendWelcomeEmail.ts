import type UserRegistered from "../Events/UserRegistered.ts";
import { notify } from "@bunyad/notifications";
import WelcomeNotification from "../Notifications/WelcomeNotification.ts";

/** Sends welcome notification (mail channel) after registration. */
export default async function SendWelcomeEmail(
  event: UserRegistered,
): Promise<void> {
  await notify(event.user, new WelcomeNotification());
}
