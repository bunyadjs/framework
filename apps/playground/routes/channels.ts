import { Broadcast, type ChannelUser } from "@bunyad/broadcasting";

/** Channel authorization (`routes/channels.php` analogue). */
export function registerChannels(): void {
  Broadcast.channel("private-user.{id}", (user: ChannelUser | null, id: string) => {
    return user != null && String(user.id) === String(id);
  });

  Broadcast.channel("presence-chat", (user: ChannelUser | null) => {
    if (!user) return false;
    return {
      id: user.id,
      name: user.name ?? user.email ?? user.id,
    };
  });

  Broadcast.channel("private-sync.{scope}", (user: ChannelUser | null, scope: string) => {
    if (!user) return false;
    if (String(user.tenant_id ?? "") === String(scope)) return true;
    return String(user.id) === String(scope);
  });
}
