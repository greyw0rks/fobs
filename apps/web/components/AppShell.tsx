import Link from "next/link";
import type { SessionUserView } from "@/lib/types";
import { initials } from "@/lib/format";

/**
 * The signed-in chrome: nav plus who you are.
 *
 * A server component, so the unread count and the identity come from the same
 * request that renders the page rather than from a fetch after paint.
 */

// `as const` so each `href` stays a literal: `typedRoutes` is on, and a widened
// `string` is not assignable to `<Link href>`.
const LINKS = [
  { href: "/feed", label: "Feed" },
  { href: "/friends", label: "Friends" },
  { href: "/stocks", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/notifications", label: "Notifications" }
] as const;

export function AppShell({
  children,
  user,
  unread
}: {
  children: React.ReactNode;
  user: SessionUserView | null;
  unread: number;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/feed">
          <span className="mark">F</span>
          <span>
            <h1>FOBS</h1>
            <p>Social stock market for Solana</p>
          </span>
        </Link>

        <nav className="nav">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
              {link.href === "/notifications" && unread > 0 ? (
                <span className="chip" style={{ marginLeft: 8 }}>
                  {unread}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>

        {user ? (
          <div className="panel" style={{ marginTop: 20 }}>
            <div className="user">
              <span className="avatar">{user.avatar ?? initials(user.displayName)}</span>
              <span>
                <strong>{user.displayName}</strong>
                <br />
                <span className="muted">@{user.username}</span>
              </span>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              {user.walletAddress ? (
                <span className="chip">
                  {user.walletAddress.slice(0, 4)}…{user.walletAddress.slice(-4)}
                </span>
              ) : (
                "No wallet yet"
              )}
            </p>
            <p style={{ marginTop: 10 }}>
              <Link href={`/profile/${user.username}`}>Your profile</Link>
            </p>
            {/* Dev-only affordance, so nobody mistakes seed accounts for real ones. */}
            {user.isTestUser ? (
              <p className="muted" style={{ marginTop: 6 }}>
                Seeded test account
              </p>
            ) : null}
            {/* A form, not a link: ending a session is a state change, and a GET
                that does it can be triggered by any page on any site. This works
                with JS off — the route handler answers with a 303 redirect. */}
            <form action="/api/auth/sign-out" method="post" style={{ marginTop: 10 }}>
              <button className="secondary" type="submit">
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <div className="panel" style={{ marginTop: 20 }}>
            <p className="muted">You are browsing signed out.</p>
            <Link className="button" href="/sign-in">
              Sign in
            </Link>
          </div>
        )}

        <p className="muted" style={{ marginTop: 16 }}>
          <Link href="/dev">/dev harness</Link>
        </p>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}

/** Shown wherever the live connection state is worth being honest about. */
export function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`chip live-dot ${connected ? "on" : "off"}`}
      title={connected ? "Receiving live events" : "Reconnecting"}
    >
      {connected ? "Live" : "Reconnecting"}
    </span>
  );
}
