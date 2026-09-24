import type {
  AssetSummary,
  FeedTrade,
  NotificationView,
  ProfileLink,
  ProfileView,
  WalletBalances
} from "@/lib/types";

/**
 * The browser's view of the API.
 *
 * Thin on purpose: every one of these maps to a route handler that reads
 * Postgres, and nothing here computes a value the server did not send.
 */

/**
 * A failed request, with the machine-readable reason the route sent.
 *
 * Some routes answer with a `code` alongside the prose — `wallet-signature-required`
 * means "this account cannot be signed for here, use the browser path", and
 * `blockhash_stale` means "sign it again". Those are decisions the client has to
 * make, and making them by matching on the message text would break the first
 * time someone improved the wording. The code is carried, and the message is
 * still there for the human.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

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
    throw new ApiError(
      body?.error ?? `${response.status} ${response.statusText}`,
      response.status,
      typeof body?.code === "string" ? body.code : null
    );
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

  /** Change the signed-in account's username. Returns the normalized result. */
  updateUsername: (username: string) =>
    json<{ username: string }>("/api/me/account", {
      method: "PATCH",
      body: JSON.stringify({ username })
    }),

  /**
   * Save the owner-written parts of the profile: a short bio and up to five
   * external links. Returns the sanitized values the server actually stored.
   */
  updateProfile: (body: { bio: string; links: ProfileLink[] }) =>
    json<{ bio: string | null; links: ProfileLink[] }>("/api/me/profile", {
      method: "PATCH",
      body: JSON.stringify(body)
    }),

  // --- Wallet sign-in and linking -------------------------------------------

  /**
   * Ask for a message to sign. `purpose: "link"` attaches the wallet to the
   * signed-in account instead of signing in as it.
   *
   * The returned `message` is handed to the wallet unchanged. It is the exact
   * string the server stored, and rebuilding it client-side — even to the same
   * text — is how a signature ends up not matching the bytes it was checked
   * against.
   */
  walletNonce: (address: string, purpose: "sign-in" | "link" = "sign-in") =>
    json<{ nonce: string; message: string; expiresAt: string }>("/api/auth/wallet/nonce", {
      method: "POST",
      body: JSON.stringify({ address, purpose })
    }),

  walletVerify: (body: {
    nonce: string;
    address: string;
    /** base64, as `signMessage` returns it. */
    signature: string;
    label?: string | null;
  }) =>
    json<{ ok: true; redirectTo?: string; address?: string; isPrimary?: boolean }>(
      "/api/auth/wallet/verify",
      { method: "POST", body: JSON.stringify(body) }
    ),

  // --- Browser-signed trades ------------------------------------------------

  /**
   * Build a trade for the user's own wallet to sign. Nothing is sent on chain
   * here — the transaction comes back unsigned, and `submitTrade` finishes it.
   */
  prepareTrade: (body: {
    symbol: string;
    side: "buy" | "sell";
    amountUsdc: number;
    /** Token base units to sell. Required for a sell, ignored for a buy. */
    amountTokens?: string | null;
    sourceTradeId?: string | null;
  }) =>
    json<{
      /** base64 VersionedTransaction, unsigned, fee-payer set to the owner. */
      transaction: string;
      lastValidBlockHeight: number | null;
      owner: string;
      /**
       * What will actually be signed. For a FOMO these come from the source
       * trade rather than the request, so they can differ from what was asked
       * for — render these, not your own inputs.
       */
      symbol: string;
      displaySymbol: string;
      kind: string;
      side: "buy" | "sell";
      amountUsdc: number;
      /** The honest, fee-adjusted swap the wallet is about to sign. */
      quote: {
        inAmount: string;
        quotedOutAmount: string;
        outAmount: string;
        feeAmount: string;
        transferFeeBps: number;
        netting: "nets" | "gross";
        venues: string[];
        unverifiedVenues: string[];
        priceImpactPctRaw: string | null;
        tokenDecimals: number;
      };
      deviation: {
        symbol: string;
        impliedPrice: number;
        referencePrice: number | null;
        deviationBps: number | null;
        verdict: string;
        referenceIsLastClose: boolean;
        reason: string;
      } | null;
    }>("/api/trades/prepare", { method: "POST", body: JSON.stringify(body) }),

  submitTrade: (body: {
    transaction: string;
    symbol: string;
    side: "buy" | "sell";
    amountUsdc: number;
    quantity: number;
    price: number;
    sourceTradeId?: string | null;
  }) =>
    json<{ trade: FeedTrade; signature: string }>("/api/trades/submit", {
      method: "POST",
      body: JSON.stringify(body)
    })
};
