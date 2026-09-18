"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { initials } from "@/lib/format";

/**
 * Sign in as a seeded test account.
 *
 * The list is rendered from the database rather than hard-coded, so it cannot
 * drift from the accounts that actually exist — and it shows each account's real
 * trade count, which doubles as a check that the indexer is running.
 */
export function DevSignIn({
  users
}: {
  users: {
    username: string;
    displayName: string;
    walletAddress: string | null;
    tradeCount: number;
  }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {error ? <p className="danger">{error}</p> : null}
      <div className="asset-list">
        {users.map((user) => (
          <div className="asset-row" key={user.username}>
            <span className="user">
              <span className="avatar">{initials(user.displayName)}</span>
              <span>
                <strong>{user.displayName}</strong>
                <br />
                <span className="muted">
                  @{user.username} · {user.tradeCount}{" "}
                  {user.tradeCount === 1 ? "trade" : "trades"}
                  {user.walletAddress
                    ? ` · ${user.walletAddress.slice(0, 4)}…${user.walletAddress.slice(-4)}`
                    : " · no wallet"}
                </span>
              </span>
            </span>
            <button
              className="button"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(user.username);
                setError(null);
                try {
                  const response = await fetch("/api/auth/dev", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ username: user.username })
                  });
                  if (!response.ok) {
                    throw new Error((await response.json()).error ?? "Sign-in failed");
                  }
                  router.push("/feed");
                  router.refresh();
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "Sign-in failed");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === user.username ? "Signing in…" : `Sign in as ${user.displayName}`}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
