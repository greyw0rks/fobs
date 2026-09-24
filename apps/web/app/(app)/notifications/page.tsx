import type { Route } from "next";
import Link from "next/link";
import { NotificationItem } from "@/components/NotificationItem";
import { Reveal } from "@/components/fobs/motion";
import { listNotifications, unreadNotificationCount } from "@/lib/server/queries";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * The notification centre — a view of the product loop. Each row says what
 * happened and who did it. The message text is rendered from the type by
 * NotificationItem rather than stored, so it can never drift from the trade it
 * describes; this page only frames it.
 */
export default async function NotificationsPage() {
  const viewer = await currentUser();

  if (!viewer) {
    return (
      <div className="mx-auto max-w-[850px] space-y-5">
        <Reveal>
          <section>
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#898a84]">
              Notifications
            </span>
            <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.05em]">Activity</h1>
            <p className="mt-1 text-sm text-[#777872]">
              Sign in to see who traded and who followed you.
            </p>
          </section>
        </Reveal>

        <Reveal delay={0.05} className="fobs-surface p-6 text-center">
          <h3 className="text-sm font-semibold">Not signed in</h3>
          <p className="mt-1 text-xs text-[#777872]">
            Notifications are per-account, so there is nothing to show until you have one.
          </p>
          <p className="mt-4">
            <Link href={"/sign-in" as Route} className="fobs-button-primary inline-flex">
              Sign in
            </Link>
          </p>
        </Reveal>
      </div>
    );
  }

  const [notifications, unread] = await Promise.all([
    listNotifications(viewer.id),
    unreadNotificationCount(viewer.id)
  ]);

  return (
    <div className="mx-auto max-w-[850px] space-y-5">
      <Reveal>
        <section>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#898a84]">
            Notifications
          </span>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.05em]">Activity</h1>
          <p className="mt-1 text-sm text-[#777872]">
            {unread > 0 ? `${unread} unread.` : "All caught up."} Generated from trades
            confirmed on chain.
          </p>
        </section>
      </Reveal>

      {notifications.length === 0 ? (
        <Reveal delay={0.05} className="fobs-surface p-6 text-center">
          <h3 className="text-sm font-semibold">Nothing yet</h3>
          <p className="mt-1 text-xs text-[#777872]">
            When someone you follow trades, or someone FOMOs your trade, it lands here and
            updates live.
          </p>
          <p className="mt-4">
            <Link href={"/friends" as Route} className="fobs-button-primary inline-flex">
              Find people to follow
            </Link>
          </p>
        </Reveal>
      ) : (
        <Reveal delay={0.05} className="fobs-surface overflow-hidden p-2 sm:p-4">
          <NotificationItem initial={notifications} unread={unread} />
        </Reveal>
      )}
    </div>
  );
}
