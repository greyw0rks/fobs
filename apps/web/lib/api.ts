import type {
  AssetSummary,
  FeedTrade,
  NotificationView,
  ProfileView,
  WalletBalances
} from "@/lib/types";

/**
 * The browser's view of the API.
 *
 * Thin on purpose: every one of these maps to a route handler that reads
 * Postgres, and nothing here computes a value the server did not send.
 */

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // The routes put a human-readable reason in `error`, including the
    // program's own preflight message for a failed trade. Surfacing that
    // verbatim beats a generic "request failed".
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  }
  return body as T;
}

export type FeedPage = {
  view: string;
  trades: FeedTrade[];
  hasMore: boolean;
  nextCursor: string | null;
};

export const api = {
  feed: (view: "for-you" | "following" = "following", before?: string | null) =>
    json<FeedPage>(
      `/api/feed?view=${view}${before ? `&before=${encodeURIComponent(before)}` : ""}`
    ),

  assets: () => json<{ assets: AssetSummary[] }>("/api/assets"),

  notifications: () =>
    json<{ notifications: NotificationView[]; unread: number }>("/api/notifications"),

  markNotificationsRead: () =>
    json<{ marked: number }>("/api/notifications", { method: "POST" }),

  follow: (username: string, follow: boolean) =>
    json<{ following: boolean }>(`/api/users/${encodeURIComponent(username)}/follow`, {
      method: follow ? "POST" : "DELETE"
    }),

  profile: (username: string) =>
    json<{ profile: ProfileView }>(`/api/users/${encodeURIComponent(username)}`),

  balances: () =>
    json<{ address: string | null; balances: WalletBalances | null }>("/api/me/balance"),

  trade: (body: { symbol: string; side: "buy" | "sell"; amountUsdc: number }) =>
    json<{ trade: FeedTrade; signature: string; receipt: string }>("/api/trades", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  fomo: (tradeId: string, amountUsdc: number) =>
    json<{ trade: FeedTrade; signature: string; receipt: string }>(
      `/api/trades/${tradeId}/fomo`,
      { method: "POST", body: JSON.stringify({ amountUsdc }) }
    )
};
