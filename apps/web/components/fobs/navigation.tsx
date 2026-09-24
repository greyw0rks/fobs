// components/fobs/navigation.tsx
//
// The signed-in left sidebar. Now the product's real nav: links point at the
// live routes and the active item is derived from the current path. The nav set
// is the gallery's smaller taxonomy — Home / Markets / Portfolio + Friends /
// Notifications. `/discover` and `/prestocks` stay reachable by URL but are not
// first-class sidebar destinations.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { Bell, House, LineChart, Users, Wallet } from "lucide-react";
import type { SessionUserView } from "@/lib/types";
import { UserMenu } from "./user-menu";

const primary = [
  { label: "Home", href: "/feed" as Route, icon: House },
  { label: "Markets", href: "/stocks" as Route, icon: LineChart },
  { label: "Portfolio", href: "/portfolio" as Route, icon: Wallet }
] as const;

const social = [
  { label: "Friends", href: "/friends" as Route, icon: Users },
  { label: "Notifications", href: "/notifications" as Route, icon: Bell }
] as const;

export function FobsSidebar({ user }: { user: SessionUserView | null }) {
  const pathname = usePathname();
  // `/feed` stays lit on `/feed?tab=…` and any child route; an exact-or-prefix
  // match, but "/" must never light every item.
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="hidden w-[220px] shrink-0 border-r border-[#e3e2dc] bg-[#f8f7f3] px-4 py-5 lg:flex lg:flex-col">
      <Link
        href={"/feed" as Route}
        className="mb-8 px-3 text-[21px] font-bold tracking-[-0.06em]"
      >
        fobs
      </Link>

      <nav className="space-y-1">
        {primary.map((item) => (
          <NavItem key={item.label} {...item} active={isActive(item.href)} />
        ))}
      </nav>

      <div className="mb-2 mt-8 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a8b84]">
        Social
      </div>

      <nav className="space-y-1">
        {social.map((item) => (
          <NavItem key={item.label} {...item} active={isActive(item.href)} />
        ))}
      </nav>

      <div className="mt-auto">
        {user ? (
          <UserMenu user={user} variant="sidebar" />
        ) : (
          <Link
            href={"/sign-in" as Route}
            className="fobs-button-primary mt-4 block text-center"
          >
            Sign in
          </Link>
        )}
      </div>
    </aside>
  );
}

function NavItem({
  label,
  href,
  icon: Icon,
  active
}: {
  label: string;
  href: Route;
  icon: typeof House;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] transition ${
        active ? "bg-[#080909] text-white" : "text-[#5f615c] hover:bg-white"
      }`}
    >
      <Icon size={15} strokeWidth={1.8} />
      {label}
    </Link>
  );
}
