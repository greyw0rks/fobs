/**
 * The in-process event bus behind `GET /api/events`.
 *
 * SSE rather than WebSockets: the traffic is one-directional and low-volume, SSE
 * reconnects on its own, and it is plain HTTP — which matters because it has to
 * survive Next's dev server and a serverless-ish deploy without a separate
 * socket tier.
 *
 * Everything here is per-process. That is the honest limitation: with more than
 * one server instance, a client connected to instance A will not see a trade
 * indexed by instance B. For a single dev-server demo that is exactly right, and
 * the fix (a Postgres LISTEN/NOTIFY or Redis fan-out behind this same interface)
 * is contained to this file. It is not worth building before there is a second
 * instance to justify it.
 */

export type TradeEvent = {
  type: "trade";
  id: string;
  userId: string;
  username: string;
  displayName: string;
  assetSymbol: string;
  side: "buy" | "sell";
  amountUsdc: string;
  quantity: string;
  price: string;
  sourceTradeId: string | null;
  txSignature: string | null;
  tradedAt: string;
};

export type NotificationEvent = {
  type: "notification";
  id: string;
  userId: string;
  kind: "FRIEND_TRADE" | "FOLLOW" | "FOMO" | "TRADE_CONFIRMED";
  actorUsername: string | null;
  actorDisplayName: string | null;
  assetSymbol: string | null;
  tradeId: string | null;
  createdAt: string;
};

/** Emitted when an indexing pass finishes, so /dev can show what happened. */
export type IndexerEvent = {
  type: "indexer";
  assets: number;
  tradesIngested: number;
  at: string;
};

export type FobsEvent = TradeEvent | NotificationEvent | IndexerEvent;

type Listener = (event: FobsEvent) => void;

/**
 * Next re-evaluates modules on every hot reload in dev. A module-level `Set`
 * would therefore be replaced — sometimes twice for the same module — while live
 * SSE connections stay attached to the *old* set and quietly stop receiving
 * anything. The symptom is a feed that updates once and then never again, which
 * looks like a bug in the SSE route rather than in module identity.
 *
 * Hanging the set on `globalThis` gives every evaluation the same instance.
 */
const globalForEvents = globalThis as unknown as {
  fobsEventBus?: Set<Listener>;
  fobsEventLog?: FobsEvent[];
};

const listeners: Set<Listener> = (globalForEvents.fobsEventBus ??= new Set<Listener>());

/**
 * The last few events, so a client that connects mid-demo can show recent
 * history instead of an empty log. Bounded — this is a demo affordance, not a
 * durable queue, and an unbounded one would leak for the life of the process.
 */
const RECENT_LIMIT = 50;
const recent: FobsEvent[] = (globalForEvents.fobsEventLog ??= []);
if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT);

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publish(event: FobsEvent): void {
  recent.push(event);
  if (recent.length > RECENT_LIMIT) recent.shift();
  for (const listener of listeners) {
    // One broken stream must not stop the others from being notified.
    try {
      listener(event);
    } catch (error) {
      console.error("event listener threw", error);
    }
  }
}

export function recentEvents(): FobsEvent[] {
  return [...recent];
}

export function subscriberCount(): number {
  return listeners.size;
}
