"use client";

import Link from "next/link";
import type { NotificationView } from "@/lib/types";
import { Avatar } from "@/components/TradeCard";
import { LiveDot } from "@/components/AppShell";
import { ago, money } from "@/lib/format";
import { useLiveNotifications } from "@/lib/use-live";
import { api } from "@/lib/api";

/**
 * Renders a notification from its type.
 *
 * Nothing here reads a stored sentence, because none is stored. Adding a
 * notification kind means adding a case here and a value to the enum — there is
 * no third place where wording lives and can disagree.
 */
function sentence(notification: NotificationView) {
  const actor = notification.actor;
  const who = actor ? (
    <Link href={`/profile/${actor.username}`}>{actor.displayName}</Link>
  ) : (
    "Someone"
  );
  const asset = notification.assetSymbol;
  const amount = money(notification.amountUsdc);

  switch (notification.type) {
    case "FRIEND_TRADE":
      return (
        <>
          {who} {notification.side === "sell" ? "sold" : "bought"} {amount} of{" "}
          {asset ?? "an asset"}
        </>
      );
    case "FOMO":
      return (
        <>
          {who} FOMO&apos;d your {asset ?? ""} trade — {amount} of their own
        </>
      );
    case "TRADE_CONFIRMED":
      return (
        <>
          Your {amount} {asset ?? ""} trade confirmed on devnet
        </>
      );
    case "FOLLOW":
      return <>{who} started following you</>;
  }
}

export function NotificationItem({
  initial,
  unread
}: {
  initial: NotificationView[];
  unread: number;
}) {
  const { notifications, connected, setState } = useLiveNotifications({
    notifications: initial,
    unread
  });

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted">
          {notifications.filter((item) => !item.read).length} unread
        </span>
        <span className="row">
          <LiveDot connected={connected} />
          <button
            className="secondary"
            onClick={async () => {
              await api.markNotificationsRead();
              const next = await api.notifications();
              setState(next);
            }}
          >
            Mark all read
          </button>
        </span>
      </div>

      {notifications.map((notification) => (
        <article className="card" key={notification.id}>
          <div className="row">
            <div className="user">
              <Avatar
                name={notification.actor?.displayName ?? "FOBS"}
                avatar={notification.actor?.avatar ?? null}
              />
              <span>
                <span>{sentence(notification)}</span>
                <br />
                <span className="muted">{ago(notification.createdAt)}</span>
              </span>
            </div>
            {!notification.read ? <span className="chip">New</span> : null}
          </div>
          <p style={{ marginTop: 10 }}>
            <Link className="secondary" href={notification.href}>
              Open
            </Link>
          </p>
        </article>
      ))}
    </>
  );
}
