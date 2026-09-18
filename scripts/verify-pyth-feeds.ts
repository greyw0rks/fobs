/**
 * Day 0: verify which price feeds are actually usable, before committing to an
 * asset list.
 *
 * Run: pnpm verify:pyth
 *
 * The design document assumed NVDA/AAPL/MSFT/TSLA would price from Pyth on
 * devnet and only AMZN would fall back to a mock oracle. That assumption is
 * wrong, and this script is how you find out rather than discovering it when
 * every trade reverts.
 *
 * Why this is not a one-liner: Pyth's `PriceUpdateV2` accounts are not
 * derivable from the feed id. Anyone can post a price update, so a single feed
 * id maps to hundreds or thousands of accounts, most of them ancient. What
 * matters is the *newest* one, so we filter on the embedded feed id and then
 * scan for the highest publish_time.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const HERMES = "https://hermes.pyth.network";

/** Pyth refuses to call a price usable past this. Mirrors MAX_PRICE_AGE_SECS. */
const MAX_PRICE_AGE_SECS = 90;

/** Offset of `feed_id` inside a PriceUpdateV2 account (8 disc + 32 auth + 1 level). */
const FEED_ID_OFFSET = 41;
/** `publish_time` is the last field of the embedded Price struct. */
const PUBLISH_TIME_OFFSET = 93;

const CLUSTERS = {
  devnet: "https://api.devnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com"
} as const;

/** Symbols we are considering. The point of the run is to decide on these. */
const CANDIDATES = ["NVDA", "AAPL", "MSFT", "TSLA", "AMZN"];

type Feed = { symbol: string; feedId: string; description: string };

type Verdict = {
  symbol: string;
  feedId: string;
  cluster: string;
  account: string | null;
  accounts: number;
  price: number | null;
  ageSecs: number | null;
  fresh: boolean;
  source: "pyth" | "mock";
};

/** Discover equity feed ids from Hermes. No API key needed for the listing.
 *  NB: `asset_type` is case-sensitive — "Equity" returns HTTP 400. */
async function discoverFeeds(symbols: string[]): Promise<Feed[]> {
  const res = await fetch(`${HERMES}/v2/price_feeds?asset_type=equity`);
  if (!res.ok) throw new Error(`Hermes listing failed: HTTP ${res.status}`);

  const all = (await res.json()) as Array<{
    id: string;
    attributes: Record<string, string>;
  }>;

  const wanted = new Map<string, Feed>();
  for (const entry of all) {
    const attrs = entry.attributes ?? {};
    const symbol = attrs.display_symbol;
    // Restrict to US equities so "NVDA" cannot match a foreign listing.
    if (!symbol || !attrs.symbol?.startsWith("Equity.US.")) continue;
    if (!symbols.includes(symbol) || wanted.has(symbol)) continue;
    wanted.set(symbol, {
      symbol,
      feedId: entry.id.replace(/^0x/, ""),
      description: attrs.description ?? ""
    });
  }

  const missing = symbols.filter((s) => !wanted.has(s));
  if (missing.length) {
    console.error(`note: no Hermes equity feed for ${missing.join(", ")}`);
  }
  return symbols.map((s) => wanted.get(s)).filter((f): f is Feed => Boolean(f));
}

/**
 * Find the newest on-chain account for a feed and read its price.
 *
 * `getProgramAccounts` with a memcmp filter is the only reliable way to locate
 * these: the account address is shard-derived, not a function of the feed id.
 */
async function inspectCluster(
  connection: Connection,
  cluster: string,
  feed: Feed
): Promise<Verdict> {
  const empty: Verdict = {
    symbol: feed.symbol,
    feedId: feed.feedId,
    cluster,
    account: null,
    accounts: 0,
    price: null,
    ageSecs: null,
    fresh: false,
    source: "mock"
  };

  try {
    const accounts = await connection.getProgramAccounts(PYTH_RECEIVER, {
      filters: [
        { memcmp: { offset: FEED_ID_OFFSET, bytes: bs58.encode(Buffer.from(feed.feedId, "hex")) } }
      ],
      // Only pull the fields we need; a busy feed has thousands of accounts.
      dataSlice: { offset: 73, length: 28 }
    });
    if (!accounts.length) return empty;

    let newest: { publishTime: number; price: number; exponent: number; key: string } | null = null;
    for (const { pubkey, account } of accounts) {
      const data = account.data;
      const publishTime = Number(data.readBigInt64LE(20));
      if (!newest || publishTime > newest.publishTime) {
        newest = {
          publishTime,
          price: Number(data.readBigInt64LE(0)),
          exponent: data.readInt32LE(16),
          key: pubkey.toBase58()
        };
      }
    }
    if (!newest) return empty;

    const ageSecs = Math.floor(Date.now() / 1000) - newest.publishTime;
    const fresh = ageSecs <= MAX_PRICE_AGE_SECS;
    return {
      symbol: feed.symbol,
      feedId: feed.feedId,
      cluster,
      account: newest.key,
      accounts: accounts.length,
      price: newest.price * Math.pow(10, newest.exponent),
      ageSecs,
      fresh,
      source: fresh ? "pyth" : "mock"
    };
  } catch (error) {
    console.error(`  ${feed.symbol}: query failed — ${(error as Error).message}`);
    return empty;
  }
}

function humanAge(secs: number | null): string {
  if (secs === null) return "-";
  if (secs < 120) return `${secs}s`;
  if (secs < 7200) return `${Math.round(secs / 60)}m`;
  if (secs < 172800) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

async function main() {
  console.log("FOBS Day 0 — price feed verification\n");

  const feeds = await discoverFeeds(CANDIDATES);
  if (!feeds.length) throw new Error("No candidate feeds discovered from Hermes");

  const results: Verdict[] = [];
  for (const [cluster, url] of Object.entries(CLUSTERS)) {
    console.log(`Scanning ${cluster}…`);
    const connection = new Connection(url, "confirmed");
    for (const feed of feeds) {
      results.push(await inspectCluster(connection, cluster, feed));
    }
  }

  for (const cluster of Object.keys(CLUSTERS)) {
    const rows = results.filter((r) => r.cluster === cluster);
    console.log(`\n=== ${cluster} ===`);
    console.table(
      rows.map((r) => ({
        symbol: r.symbol,
        "newest acct age": humanAge(r.ageSecs),
        price: r.price === null ? "-" : `$${r.price.toFixed(2)}`,
        accounts: r.accounts,
        verdict: r.fresh ? "FRESH" : "STALE",
        "use source": r.source
      }))
    );
  }

  // The decision this script exists to make.
  const devnet = results.filter((r) => r.cluster === "devnet");
  const usable = devnet.filter((r) => r.fresh);
  console.log("\n=== decision for devnet ===");
  for (const r of devnet) {
    console.log(
      `  ${r.symbol.padEnd(6)} -> ${r.source.toUpperCase()}` +
        (r.fresh ? "" : `  (newest on-chain price is ${humanAge(r.ageSecs)} old)`)
    );
  }
  console.log(
    `\n${usable.length}/${devnet.length} equity feeds are live on devnet.` +
      (usable.length === 0
        ? " Register every asset with PriceSource::Mock. The Pyth path stays wired for mainnet."
        : "")
  );

  console.log("\nFeed ids (paste into the asset registry):");
  for (const feed of feeds) {
    console.log(`  ${feed.symbol.padEnd(6)} ${feed.feedId}  ${feed.description}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
