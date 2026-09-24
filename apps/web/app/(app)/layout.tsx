import { redirect } from "next/navigation";
import { FobsShell } from "@/components/fobs/shell";
import { unreadNotificationCount } from "@/lib/server/queries";
import { currentUser } from "@/lib/server/session";

/**
 * The signed-in shell.
 *
 * A signed-*out* visitor is never redirected: the product opens on the feed, not
 * a sign-in wall, and a feed you can read is a better argument for signing in
 * than a form. But a signed-*in* account with no connected wallet is sent to
 * `/welcome` to finish onboarding — connecting a wallet is a required step, and
 * `/welcome` lives outside this `(app)` group so the redirect cannot loop. On
 * this no-custody deployment every wallet is one the user holds, so there is no
 * server-signer account to exempt.
 */
export default async function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();

  if (user && !user.walletAddress) {
    redirect("/welcome");
  }

  const unread = user ? await unreadNotificationCount(user.id) : 0;

  return (
    <FobsShell user={user} unread={unread}>
      {children}
    </FobsShell>
  );
}
