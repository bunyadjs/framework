import type { Request } from "@bunyad/http";
import { json } from "@bunyad/http";
import { Auth } from "@bunyad/auth";
import { Broadcast, type ChannelUser } from "@bunyad/broadcasting";

async function resolveUser(request: Request): Promise<ChannelUser | null> {
  return (
    ((await Auth().user(request)) as ChannelUser | null) ??
    ((await Auth.guard("token").user(request)) as ChannelUser | null) ??
    null
  );
}

function presenceInfo(
  user: ChannelUser,
  authResult: true | Record<string, unknown>,
): Record<string, unknown> {
  if (authResult !== true && authResult != null) {
    return { ...authResult };
  }
  return {
    id: user.id,
    name: user.name ?? user.email ?? user.id,
  };
}

export default class BroadcastingController {
  /** SSE stream: `GET /api/broadcasting/sse?channel=users&channel=presence-chat` */
  async sse(request: Request) {
    const url = new URL(request.url);
    const channels = url.searchParams.getAll("channel");
    if (channels.length === 0) {
      return json({ message: "channel query required" }, 422);
    }

    const user = await resolveUser(request);
    const authResults = new Map<string, true | Record<string, unknown>>();

    for (const channel of channels) {
      const allowed = await Broadcast.authorize(channel, user);
      if (!allowed) {
        return json({ message: `Unauthorized channel [${channel}].` }, 403);
      }
      authResults.set(channel, allowed === true ? true : allowed);
    }

    const hub = Broadcast.hub();
    const presence = Broadcast.presence();
    const presenceChannels = channels.filter((c) => c.startsWith("presence-"));

    if (presenceChannels.length > 0 && user?.id != null) {
      for (const channel of presenceChannels) {
        const info = presenceInfo(user, authResults.get(channel)!);
        const here = await presence.join(channel, user, info);
        hub.publish([channel], "presence.here", {
          channel,
          members: here,
        });
        hub.publish([channel], "presence.joining", {
          channel,
          member: { id: String(user.id), info },
        });
      }
    }

    return hub.subscribe(channels, {
      onCancel: () => {
        if (user?.id == null) return;
        void (async () => {
          for (const channel of presenceChannels) {
            const members = await presence.leave(channel, user.id!);
            hub.publish([channel], "presence.leaving", {
              channel,
              id: String(user.id),
            });
            hub.publish([channel], "presence.here", { channel, members });
          }
        })();
      },
    });
  }

  /**
   * channel auth.
   * `POST /api/broadcasting/auth` body: `{ channel_name, socket_id? }`
   */
  async auth(request: Request) {
    await request.loadJson();
    const channelName = String(request.input("channel_name") ?? "");
    if (!channelName) {
      return json({ message: "channel_name required" }, 422);
    }

    const user = await resolveUser(request);
    const result = await Broadcast.authorize(channelName, user);
    if (!result) {
      return json({ message: "Forbidden" }, 403);
    }

    if (channelName.startsWith("presence-") && result !== true) {
      return json({
        auth: true,
        channel_name: channelName,
        socket_id: request.input("socket_id") ?? null,
        channel_data: {
          user_id: String(user?.id ?? ""),
          user_info: result,
        },
        members: await Broadcast.presence().members(channelName),
      });
    }

    if (result === true) {
      return json({
        auth: true,
        channel_name: channelName,
        socket_id: request.input("socket_id") ?? null,
        ...(channelName.startsWith("presence-")
          ? { members: await Broadcast.presence().members(channelName) }
          : {}),
      });
    }

    return json({
      auth: true,
      channel_name: channelName,
      socket_id: request.input("socket_id") ?? null,
      channel_data: result,
    });
  }
}
