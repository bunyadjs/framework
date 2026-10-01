/**
 * In-process SSE fan-out hub for realtime broadcasts.
 */
export class SseHub {
  readonly #clients = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
  readonly #encoder = new TextEncoder();

  /** Subscribe to one or more channels; returns an SSE `Response`. */
  subscribe(
    channels: string[],
    options: { onCancel?: () => void } = {},
  ): Response {
    const unique = [...new Set(channels.filter(Boolean))];
    let controllers: ReadableStreamDefaultController<Uint8Array>[] = [];

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllers = [controller];
        for (const channel of unique) {
          const set = this.#clients.get(channel) ?? new Set();
          set.add(controller);
          this.#clients.set(channel, set);
        }
        controller.enqueue(this.#encoder.encode(": connected\n\n"));
      },
      cancel: () => {
        for (const channel of unique) {
          const set = this.#clients.get(channel);
          if (!set) continue;
          for (const c of controllers) set.delete(c);
          if (set.size === 0) this.#clients.delete(channel);
        }
        options.onCancel?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  publish(
    channels: string[],
    event: string,
    payload: Record<string, unknown>,
  ): void {
    const data = `event: ${event}\ndata: ${JSON.stringify({ channels, payload })}\n\n`;
    const chunk = this.#encoder.encode(data);
    for (const channel of channels) {
      const set = this.#clients.get(channel);
      if (!set) continue;
      for (const controller of [...set]) {
        try {
          controller.enqueue(chunk);
        } catch {
          set.delete(controller);
        }
      }
    }
  }

  /** Active subscriber count across all channels. */
  size(): number {
    let n = 0;
    for (const set of this.#clients.values()) n += set.size;
    return n;
  }
}
