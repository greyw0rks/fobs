import Link from "next/link";
import { FeedView } from "@/components/FeedView";
import { listAssets, listFeed, type FeedView as FeedViewName } from "@/lib/server/queries";
import { currentUserOrDevFallback } from "@/lib/server/session";
import { price, synthetic } from "@/lib/format";

export const dynamic = "force-dynamic";

const TABS: { id: FeedViewName; label: string }[] = [
  { id: "following", label: "Following" },
  { id: "for-you", label: "For You" }
];

export default async function FeedPage({
  searchParams
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const view: FeedViewName = tab === "for-you" ? "for-you" : "following";

  const viewer = await currentUserOrDevFallback();
  const [trades, assets] = await Promise.all([
    listFeed({ view, viewerId: viewer?.id ?? null }),
    listAssets()
  ]);

  return (
    <>
      <div className="topbar">
        <div>
          <h2>See what your people are buying.</h2>
          <p>
            Every trade below is a receipt someone published to devnet. FOMO opens
            your own trade at your own size — it never copies theirs.
          </p>
        </div>
      </div>

      <nav className="tabs">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/feed?tab=${item.id}`}
            className={`tab${view === item.id ? " active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
        <Link className="tab" href="/stocks">
          Markets
        </Link>
      </nav>

      <div className="grid">
        <section className="feed">
          {view === "following" && !viewer ? (
            <div className="card">
              <h3>Sign in to build your feed</h3>
              <p className="muted">
                The Following feed is the trades of accounts you follow.{" "}
                <Link href="/sign-in">Sign in</Link> to follow people, or switch to For
                You to see the whole room.
              </p>
            </div>
          ) : trades.length === 0 ? (
            <div className="card">
              <h3>Nothing here yet</h3>
              <p className="muted">
                {view === "following"
                  ? "Nobody you follow has traded yet. Follow someone from Friends, or switch to For You."
                  : "No trades have been indexed yet. Run one from the /dev harness, then refresh the indexer."}
              </p>
            </div>
          ) : (
            <FeedView view={view} initial={trades} />
          )}
        </section>

        <aside className="stack">
          <div className="panel disclosure">
            <strong>Synthetic assets.</strong> Every symbol here is a synthetic token
            that tracks a real company&apos;s price — it is not stock and confers no
            ownership. All five price from MockOracle on devnet because no Pyth equity
            feed is published there; each carries a verified mainnet Pyth feed id.
          </div>

          <div className="panel">
            <h3>Markets</h3>
            <div className="asset-list">
              {assets.map((asset) => (
                <Link className="asset-row" key={asset.id} href={`/asset/${asset.symbol}`}>
                  <span>
                    <strong>{asset.symbol}</strong>
                    <br />
                    <span className="muted">{synthetic(asset.symbol)}</span>
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <strong>{price(asset.price)}</strong>
                    <br />
                    <span className="muted">
                      {asset.priceKnown ? `${asset.tradeCount} trades` : "price not read"}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
