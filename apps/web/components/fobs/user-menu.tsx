// components/fobs/user-menu.tsx
//
// The signed-in identity control, now with a dropdown whose point is a real
// Log out. Sign-out is a POST form to /api/auth/sign-out — which deletes the
// session row, not just the cookie — so it stays a POST a button submits rather
// than a GET link any page could trigger. Two visual variants share one menu:
// the sidebar footer (opens upward) and the top-bar avatar (opens downward,
// right-aligned), so both desktop and mobile can reach it.

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { LogOut, Settings, User as UserIcon } from "lucide-react";
import type { SessionUserView } from "@/lib/types";
import { initials } from "@/lib/format";

export function UserMenu({
  user,
  variant
}: {
  user: SessionUserView;
  variant: "sidebar" | "topbar";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside pointer-down or Escape while open — a menu that only the
  // trigger can dismiss traps the pointer.
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          variant === "sidebar"
            ? "mt-4 flex w-full items-center gap-3 rounded-[10px] border-t border-[#e3e2dc] px-3 pt-4 text-left transition hover:bg-white"
            : "flex items-center gap-2 rounded-full transition hover:opacity-80"
        }
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#dceafa] text-xs font-semibold">
          {initials(user.displayName)}
        </div>

        {variant === "sidebar" ? (
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">{user.displayName}</div>
            <div className="text-[10px] text-[#85867f]">@{user.username}</div>
          </div>
        ) : (
          <span className="hidden text-xs font-medium sm:block">{user.displayName}</span>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className={`absolute z-50 w-52 overflow-hidden rounded-xl border border-[#e3e2dc] bg-white py-1 shadow-[0_8px_28px_rgba(0,0,0,0.10)] ${
            variant === "sidebar" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2"
          }`}
        >
          <div className="border-b border-[#efeee9] px-3 py-2">
            <div className="truncate text-xs font-semibold">{user.displayName}</div>
            <div className="truncate text-[10px] text-[#85867f]">@{user.username}</div>
          </div>

          <MenuLink
            href={`/profile/${user.username}` as Route}
            icon={UserIcon}
            label="View profile"
            onNavigate={() => setOpen(false)}
          />
          <MenuLink
            href={"/account" as Route}
            icon={Settings}
            label="Account"
            onNavigate={() => setOpen(false)}
          />

          <div className="my-1 border-t border-[#efeee9]" />

          <form action="/api/auth/sign-out" method="post" className="px-1">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-[#c94c4c] transition hover:bg-[#faf0ef]"
            >
              <LogOut size={15} strokeWidth={1.8} />
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  icon: Icon,
  label,
  onNavigate
}: {
  href: Route;
  icon: typeof UserIcon;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="mx-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-[#3a3b36] transition hover:bg-[#f2f1ec]"
    >
      <Icon size={15} strokeWidth={1.8} />
      {label}
    </Link>
  );
}
