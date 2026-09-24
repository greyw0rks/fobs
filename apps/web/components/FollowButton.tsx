"use client";

import { useState } from "react";
import { api } from "@/lib/api";

/**
 * Follow/unfollow.
 *
 * The button owns its own optimistic state and rolls back on failure rather than
 * waiting for a round trip — a follow is instantly reversible, so the honest
 * failure mode is "it flips back", not "it does nothing for a second".
 */
export function FollowButton({
  username,
  following,
  signedIn
}: {
  username: string;
  following: boolean;
  signedIn: boolean;
}) {
  const [isFollowing, setIsFollowing] = useState(following);
  const [busy, setBusy] = useState(false);

  if (!signedIn) {
    return (
      <a className="fobs-button-secondary inline-flex" href="/sign-in">
        Sign in to follow
      </a>
    );
  }

  return (
    <button
      className={isFollowing ? "fobs-button-secondary" : "fobs-button-primary"}
      disabled={busy}
      onClick={async () => {
        const next = !isFollowing;
        setBusy(true);
        setIsFollowing(next);
        try {
          await api.follow(username, next);
        } catch {
          setIsFollowing(!next);
        } finally {
          setBusy(false);
        }
      }}
    >
      {isFollowing ? "Following" : "Follow"}
    </button>
  );
}
