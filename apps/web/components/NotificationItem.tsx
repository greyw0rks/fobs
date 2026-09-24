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
          Your {amount} {asset ?? ""} trade confirmed on mainnet
        </>
      );
    case "FOLLOW":
      return <>{who} started following you</>;
  }
}

/**
 * The activity list.
 *
 * A timeline inside one panel rather than a stack of cards. Each notification
 * is a line in a log — one avatar, one sentence, one timestamp — and giving
 * each its own elevated card made ten events read as ten separate objects
 * instead of one stream.
 */
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

  const remaining = notifications.filter((item) => !item.read).length;

  return (
    <>
      <div className="flex items-center justify-between border-b border-[#efeee9] px-1 pb-3">
        <span className="text-xs text-[#777872]">
          <span className="font-semibold text-[#111312] tabular-nums">{remaining}</span> unread
        </span>
        <span className="flex items-center gap-2">
          <LiveDot connected={connected} />
          {remaining > 0 ? (
            <button
              className="rounded-lg border border-[#e3e2dc] bg-white px-3 py-1.5 text-[11px] font-medium text-[#111312] transition-colors hover:bg-[#f2f1ec]"
              onClick={async () => {
                await api.markNotificationsRead();
                const next = await api.notifications();
                setState(next);
              }}
            >
              Mark all read
            </button>
          ) : null}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex flex-col">
          {notifications.map((notification) => (
            <Link
              className={`flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-[#f2f1ec]${notification.read ? "" : " bg-[#f7f6f2]"}`}
              key={notification.id}
              href={notification.href}
            >
              <Avatar
                name={notification.actor?.displayName ?? "FOBS"}
                avatar={notification.actor?.avatar ?? null}
              />

              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm text-[#111312]">{sentence(notification)}</span>
                <span className="mt-0.5 text-[11px] text-[#9b9c95]">{ago(notification.createdAt)}</span>
              </span>

              {!notification.read ? (
                <span className="rounded-full bg-[#dceafa] px-2 py-0.5 text-[10px] font-medium text-[#3175c6]">
                  New
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
