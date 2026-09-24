/**
 * The shapes that cross the wire.
 *
 * Defined here rather than inside `lib/server/queries.ts` so the client can
 * import them without pulling Prisma into the browser bundle. The server
 * functions return exactly these types, so the two cannot drift — a change to a
 * query's output breaks the component that renders it at typecheck, not at
 * runtime in front of an audience.
 *
 * Everything is JSON-safe by construction: numbers not `Decimal`, ISO strings
 * not `Date`. Prisma's `Decimal` and `Date` do not survive `JSON.stringify`
 * with their types intact, and the failure is silent — a component receives a
 * string where it expected a number and renders `NaN`.
 */

export type TradeSide = "buy" | "sell";
/**
 * Where a price came from, as the UI needs to say it.
 *
 * `pyth` is a Pyth `PriceUpdateV2` account the program read directly. `market`
 * is a real market price the operator pushed into the program's admin-written
 * oracle — which is what devnet forces, because it publishes no usable Pyth
 * US-equity feed. The database column still reads `mock`; that is the program's
 * own `PriceSource` name and renaming it would mean a redeploy. What the *user*
 * is told is what the number actually is, and it is a real price.
 */
export type PriceFeedType = "pyth" | "market";
export type FeedView = "for-you" | "following";
export type NotificationType = "FRIEND_TRADE" | "FOLLOW" | "FOMO" | "TRADE_CONFIRMED";

export type FeedUser = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
};

/** One external link an account owner chooses to show on their profile. */
export type ProfileLink = {
  label: string;
  url: string;
};

export type FeedAsset = {
  id: string;
  symbol: string;
  name: string;
  /**
   * Null until the indexer has read this asset's oracle once. Rendering a
   * fallback price here would be inventing market data, so the UI shows that
   * the price is not known yet instead.
   */
  price: number | null;
  priceFeedType: PriceFeedType;
  pythFeedId: string | null;
  priceKnown: boolean;
  /**
   * When the oracle's value last moved, ISO. Null until the indexer has read
   * the oracle once.
   *
   * Published next to the price rather than kept server-side because a price
   * with no age reads as current whether or not it is, and outside market hours
   * a real price is genuinely hours old. The UI says how old.
   */
  priceUpdatedAt: string | null;
};

export type FeedTrade = {
  id: string;
  side: TradeSide;
  amountUsdc: number;
  quantity: number;
  price: number;
  tradedAt: string;
  /** Null only if the signature lookup failed; the trade itself is still real. */
  txSignature: string | null;
  onchainReceipt: string;
  user: FeedUser;
  asset: FeedAsset;
  fomoCount: number;
  viewerFomoed: boolean;
  source: { id: string; user: FeedUser; amountUsdc: number } | null;
};

export type AssetSummary = FeedAsset & {
  /** xstock | prestock | ondo. Null only for a legacy synthetic row. */
  kind: string | null;
  /** Synthetic-program addresses — null for a bridged asset, which has no PDAs. */
  onchainId: number | null;
  assetAddress: string | null;
  mintAddress: string;
  vaultAddress: string | null;
  oracleAddress: string | null;
  tradeCount: number;
  traderCount: number;
};

export type NotificationHref = "/feed" | `/asset/${string}` | `/profile/${string}`;

export type NotificationView = {
  id: string;
  type: NotificationType;
  createdAt: string;
  read: boolean;
  actor: FeedUser | null;
  assetSymbol: string | null;
  assetName: string | null;
  tradeId: string | null;
  amountUsdc: number | null;
  side: TradeSide | null;
  /**
   * The three destinations a notification can have. Narrower than `string` so a
   * typo in the query is caught there rather than silently rendering a dead
   * link, and narrower than Next's `Route` so this module does not depend on
   * `.next/types/routes.d.ts` — a build artifact that does not exist on a clean
   * checkout. Each member is in Next's generated route union, so `<Link>` takes
   * it without a cast.
   */
  href: NotificationHref;
};

export type SessionUserView = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  walletAddress: string | null;
  onboarded: boolean;
};

export type ProfileView = {
  user: FeedUser & {
    walletAddress: string | null;
    createdAt: string;
    /** Null until the owner writes one; never a fabricated placeholder. */
    bio: string | null;
    /** The owner's chosen external links. Empty when none are set. */
    links: ProfileLink[];
    /** Whether an X / Google identity is attached — the fact, not the id. */
    hasX: boolean;
    hasGoogle: boolean;
  };
  followers: number;
  following: number;
  trades: FeedTrade[];
  viewerFollows: boolean;
  isViewer: boolean;
};

export type PersonView = FeedUser & {
  followerCount: number;
  tradeCount: number;
  viewerFollows: boolean;
  isViewer: boolean;
};

/**
 * One position. Mirrors the program's own `Holding` account, read off the chain
 * by the indexer — `avgPrice` is the program's volume-weighted entry, not
 * something computed here from the trade history.
 */
export type HoldingView = {
  asset: FeedAsset;
  quantity: number;
  avgPrice: number;
  /**
   * Quantity × the asset's cached oracle price. Null when the price has not
   * been read yet — and so is every figure derived from it, all the way up to
   * the portfolio total. A valuation built on a missing price is a made-up
   * number, which is the one thing this app does not show.
   */
  value: number | null;
  /** Value ÷ the total of all priced holdings. Null when value is null. */
  allocation: number | null;
  /** (price − avgPrice) × quantity. Null when value is null. */
  unrealizedPnl: number | null;
  /** unrealizedPnl ÷ cost basis. Null when value is null. */
  unrealizedPct: number | null;
};

export type PortfolioView = {
  holdings: HoldingView[];
  /** Sum over holdings whose price is known. Null if none is. */
  totalValue: number | null;
  /** Cost basis of those same holdings, so the total P&L has a denominator. */
  totalCost: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
  /** How many holdings are excluded from the total because their price is unread. */
  unpricedCount: number;
};

/**
 * What a wallet holds, read live from devnet rather than from the database.
 *
 * It lives here rather than beside the query because the trade panel needs it in
 * the browser: a balance is the one number the UI refuses a trade against, and a
 * stale one would disable a button for a trade that would have succeeded.
 */
export type WalletBalances = {
  /** Lamports → SOL. */
  sol: number;
  /** Test USDC, in whole USDC. */
  usdc: number;
  /**
   * False when the USDC token account does not exist yet. A wallet that has
   * never held USDC has no account rather than a zero balance, and the two are
   * worth distinguishing: "no account" is why a first trade creates one.
   */
  usdcAccountExists: boolean;
};
