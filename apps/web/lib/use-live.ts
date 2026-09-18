"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedTrade } from "@/lib/types";
import type { FobsEvent } from "@/lib/server/events";
import { api } from "@/lib/api";

/**
 * A live feed, fed by `GET /api/events`.
 *
 * The page renders server-fetched trades immediately and this subscribes
 * alongside them, so the first paint never waits on a connection. When a trade
 * event arrives the client refetches the feed rather than splicing the event
 * into state — the event is a *signal that something changed*, not the
 * authoritative row. That keeps one rendering path for trades (the query) and
 * means a missed event costs a stale list, not a wrong one.
 *
 * `EventSource` reconnects on its own, so the only state worth tracking is
 * whether we are currently connected, for the UI to show honestly.
 *
 * Pagination is the one place where "refetch and replace" needs care. A live
 * refresh fetches only the *first* page, so replacing the list wholesale would
 * silently throw away everything "Load more" had appended — the list would
 * shrink back to 50 the moment anyone traded. So the first page is refetched and
 * *merged* into what is on screen: new trades arrive at the top, the rest keeps
 * its order. The merged list is trimmed to what was there before, so a refresh
 * never grows the page under the reader's cursor either.
 */
export function useLiveFeed(view: "for-you" | "following", initial: FeedTrade[]) {
  const [trades, setTrades] = useState<FeedTrade[]>(initial);
  const [hasMore, setHasMore] = useState(false);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<FobsEvent | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // A refetch in flight must not be overtaken by a later one that resolves
  // first, which would leave the older result on screen.
  const inFlight = useRef(0);

  /** Newest-first merge of a freshly fetched page into the current list. */
  const merge = useCallback((page: FeedTrade[]) => {
    setTrades((current) => {
      if (current.length === 0) return page;
      const seen = new Set(current.map((trade) => trade.id));
      const fresh = page.filter((trade) => !seen.has(trade.id));
      if (fresh.length === 0) return current;
      return [...fresh, ...current].slice(0, Math.max(current.length, page.length));
    });
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/events");

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.onmessage = (message) => {
      let event: FobsEvent;
      try {
        event = JSON.parse(message.data) as FobsEvent;
      } catch {
        return;
      }
      setLastEvent(event);
      if (event.type !== "trade") return;

      const ticket = ++inFlight.current;
      void api
        .feed(viewRef.current)
        .then((result) => {
          if (ticket === inFlight.current) merge(result.trades);
        })
        .catch(() => {
          // A failed refresh leaves the previous list up. The next event, or a
          // manual reload, will catch up.
        });
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, [merge]);

  // Switching tabs is a server concern, not a client filter: "following" and
  // "for you" are different queries, so refetch when the view changes.
  useEffect(() => {
    let cancelled = false;
    void api
      .feed(view)
      .then((result) => {
        if (cancelled) return;
        setTrades(result.trades);
        setHasMore(result.hasMore);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [view]);

  const loadMore = useCallback(async () => {
    const oldest = trades[trades.length - 1];
    if (!oldest) return;
    const result = await api.feed(viewRef.current, oldest.tradedAt);
    setTrades((current) => {
      const seen = new Set(current.map((trade) => trade.id));
      return [...current, ...result.trades.filter((trade) => !seen.has(trade.id))];
    });
    setHasMore(result.hasMore);
  }, [trades]);

  return { trades, connected, lastEvent, hasMore, loadMore };
}

/** Notifications, same idea: the event says refetch, the query owns the data. */
export function useLiveNotifications(initial: {
  notifications: import("@/lib/types").NotificationView[];
  unread: number;
}) {
  const [state, setState] = useState(initial);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      let event: FobsEvent;
      try {
        event = JSON.parse(message.data) as FobsEvent;
      } catch {
        return;
      }
      if (event.type !== "notification") return;
      void api.notifications().then(setState).catch(() => {});
    };
    return () => {
      source.close();
      setConnected(false);
    };
  }, []);

  return { ...state, connected, setState };
}
