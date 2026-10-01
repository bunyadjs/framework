import { ShouldBroadcast } from "@bunyad/broadcasting";
import type { Authenticatable } from "@bunyad/auth";

/** Broadcast when a user registers (sync/log broadcaster). */
export default class UserRegisteredBroadcast extends ShouldBroadcast {
  constructor(readonly user: Authenticatable) {
    super();
  }

  broadcastOn(): string {
    return "users";
  }

  broadcastAs(): string {
    return "user.registered";
  }

  broadcastWith(): Record<string, unknown> {
    return {
      id: this.user.id,
      email: this.user.email,
    };
  }
}
