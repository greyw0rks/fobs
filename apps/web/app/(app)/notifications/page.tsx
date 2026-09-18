import Link from "next/link";
import { NotificationItem } from "@/components/NotificationItem";
import { listNotifications, unreadNotificationCount } from "@/lib/server/queries";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * The notification centre — which is really a view of the product loop.
 *
 * Each row says what happened *and who did it*, because the point of a
 * notification here is social: someone you follow traded, or someone followed
 * you in. The message text is rendered from the type rather than stored, so it
 * can never drift from the trade it describes.
 */
export default async function NotificationsPage() {
  const viewer = await currentUser();

  if (!viewer) {
    return (
      <>
        <div className="topbar">
          <div>
            <h2>Notifications</h2>
            <p>Sign in to see who traded and who followed you.</p>
          </div>
        </div>
        <div className="card">
          <h3>Not signed in</h3>
          <p className="muted">
            <Link href="/sign-in">Sign in</Link> to get notified when the people you
            follow trade.
          </p>
        </div>
      </>
    );
  }

  const [notifications, unread] = await Promise.all([
    listNotifications(viewer.id),
    unreadNotificationCount(viewer.id)
  ]);

  return (
    <>
      <div className="topbar">
        <div>
          <h2>Notifications</h2>
          <p>
            {unread > 0
              ? `${unread} unread.`
              : "All caught up."}{" "}
            These are generated from trades the indexer read off the chain.
          </p>
        </div>
      </div>

      <section className="feed">
        {notifications.length === 0 ? (
          <div className="card">
            <h3>Nothing yet</h3>
            <p className="muted">
              When someone you follow trades, or someone FOMOs your trade, it lands
              here and updates live.
            </p>
          </div>
        ) : (
          <NotificationItem initial={notifications} unread={unread} />
        )}
      </section>
    </>
  );
}
