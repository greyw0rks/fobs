import { currentUserOrDevFallback } from "@/lib/server/session";
import { recentEvents, subscribe, type FobsEvent } from "@/lib/server/events";

/**
 * `GET /api/events` — the live wire.
 *
 * SSE, not WebSockets: the traffic is one-directional, low-volume, and SSE
 * reconnects on its own, which matters because a demo laptop sleeps and a socket
 * does not come back by itself.
 *
 * Events are filtered per subscriber by user id. A notification is for one
 * person, so broadcasting every notification to every client would leak the
 * social graph to anyone with the page open — the filter is a correctness
 * requirement, not an optimisation.
 */

export const dynamic = "force-dynamic";
/** SSE must not be buffered or time-limited by the runtime. */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const viewer = await currentUserOrDevFallback();
  const viewerId = viewer?.id ?? null;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: FobsEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The client went away between our check and this write. Nothing to do
          // but stop; the cancel handler will clean up.
          closed = true;
        }
      };

      const visible = (event: FobsEvent) => {
        if (event.type === "notification") return event.userId === viewerId;
        return true;
      };

      // Replay so a page opened mid-demo is not blank until the next trade.
      for (const event of recentEvents()) if (visible(event)) send(event);

      const unsubscribe = subscribe((event) => {
        if (visible(event)) send(event);
      });

      // Comment frames keep proxies and the browser from treating an idle
      // connection as dead and closing it.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 25_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", cleanup);
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and friends buffer responses by default, which turns a live feed
      // into a batch delivery at the end.
      "x-accel-buffering": "no"
    }
  });
}
