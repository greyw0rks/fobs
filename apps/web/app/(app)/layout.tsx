import { AppShell } from "@/components/AppShell";
import { unreadNotificationCount } from "@/lib/server/queries";
import { currentUserOrDevFallback } from "@/lib/server/session";

/**
 * The signed-in shell.
 *
 * Note what this does *not* do: it does not redirect a signed-out visitor. The
 * spec is explicit that the product opens on the feed, not on a sign-in wall,
 * and a feed you can read is a better argument for signing in than a form. The
 * pages that actually require an identity (trading, notifications) check for one
 * themselves.
 */
export default async function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await currentUserOrDevFallback();
  const unread = user ? await unreadNotificationCount(user.id) : 0;

  return (
    <AppShell user={user} unread={unread}>
      {children}
    </AppShell>
  );
}
