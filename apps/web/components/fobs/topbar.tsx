// components/fobs/topbar.tsx
//
// The app top bar: search left, network + notifications + identity right.
// The network pill reads "Mainnet" — Fobs has moved off the devnet mint to a
// no-custody mainnet swap. Search is a real GET form to /friends (people
// search), the bell links to /notifications with an unread badge, and the
// identity is the signed-in user.

import Link from "next/link";
import type { Route } from "next";
import { Bell, Search } from "lucide-react";
import type { SessionUserView } from "@/lib/types";
import { UserMenu } from "./user-menu";

export function FobsTopbar({
  user,
  unread = 0
}: {
  user: SessionUserView | null;
  unread?: number;
}) {
  return (
    <header className="flex h-[64px] items-center justify-between border-b border-[#e3e2dc] px-5 lg:px-7">
      <form
        action="/friends"
        method="get"
        className="group flex h-10 w-full max-w-[380px] items-center gap-2.5 rounded-full border border-[#e3e2dc] bg-[#f2f1ec] px-4 transition-colors focus-within:border-[#c7c6bf] focus-within:bg-white focus-within:shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
      >
        <Search
          size={15}
          className="shrink-0 text-[#9b9c95] transition-colors group-focus-within:text-[#3175c6]"
        />

        <input
          name="q"
          placeholder="Search people…"
          className="w-full bg-transparent text-xs outline-none placeholder:text-[#9b9c95]"
        />

        <kbd className="hidden shrink-0 rounded-md border border-[#dcdbd4] bg-white px-1.5 py-0.5 text-[9px] font-medium text-[#9b9c95] transition-opacity group-focus-within:opacity-0 sm:block">
          ↵
        </kbd>
      </form>

      <div className="ml-4 flex shrink-0 items-center gap-3">
        <div className="hidden items-center gap-2 rounded-full border border-[#dfe3dd] bg-white px-3 py-1.5 text-[11px] sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[#28a267]" />
          Mainnet
        </div>

        <Link
          href={"/notifications" as Route}
          aria-label="Notifications"
          className="relative hidden text-[#5e605b] transition hover:text-black sm:block"
        >
          <Bell size={17} />
          {unread > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#c94c4c] px-1 text-[9px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Link>

        {user ? (
          <UserMenu user={user} variant="topbar" />
        ) : (
          <Link href={"/sign-in" as Route} className="fobs-button-primary whitespace-nowrap">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
