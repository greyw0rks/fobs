// components/fobs/shell.tsx
//
// The canonical signed-in layout: fixed sidebar (lg+), top bar, and a centred
// content column. The bottom tab bar takes over below lg. This is the product's
// real app shell — it takes the signed-in user and unread-notification count and
// threads them into the chrome.

import type { SessionUserView } from "@/lib/types";
import { FobsSidebar } from "./navigation";
import { FobsTopbar } from "./topbar";
import { MobileNav } from "./mobile-nav";

export function FobsShell({
  children,
  user,
  unread = 0
}: {
  children: React.ReactNode;
  user: SessionUserView | null;
  unread?: number;
}) {
  return (
    <div className="fobs-page">
      <div className="flex min-h-screen">
        <FobsSidebar user={user} />

        <div className="min-w-0 flex-1">
          <FobsTopbar user={user} unread={unread} />

          <main className="mx-auto max-w-[1500px] px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:pb-8">
            {children}
          </main>
        </div>
      </div>

      <MobileNav />
    </div>
  );
}
