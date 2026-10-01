import type { Authenticatable } from "@bunyad/auth";
import { Event } from "@bunyad/events";

export default class UserRegistered extends Event {
  constructor(readonly user: Authenticatable) {
    super();
  }
}
