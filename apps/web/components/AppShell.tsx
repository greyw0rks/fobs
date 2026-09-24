// The signed-in chrome now lives in components/fobs/{shell,navigation,topbar,
// mobile-nav}.tsx (the warm editorial shell). Only LiveDot remains here — it is
// still imported by FeedView and NotificationItem to report the live-events
// connection state, and keeping the import path stable avoids churn there.

/** Shown wherever the live connection state is worth being honest about. */
export function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`chip live-dot ${connected ? "on" : "off"}`}
      title={connected ? "Receiving live events" : "Reconnecting"}
    >
      {connected ? "Live" : "Reconnecting"}
    </span>
  );
}
