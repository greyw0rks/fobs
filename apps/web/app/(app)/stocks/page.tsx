import Link from "next/link";
import { listAssets } from "@/lib/server/queries";
import { price, synthetic } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The market list.
 *
 * Deliberately sparse: symbol, what it tracks, price, and how many trades have
 * actually been indexed. There is no 24h change column because the app has no
 * price history to compute one from, and a plausible-looking invented percentage
 * is the single most dangerous thing this page could show.
 */
export default async function StocksPage() {
  const assets = await listAssets();

  return (
    <>
      <div className="topbar">
        <div>
          <h2>Markets</h2>
          <p>
            Five synthetic assets. Prices come from each asset&apos;s onchain oracle
            account, read by the indexer — the same account the trade program prices
            against.
          </p>
        </div>
      </div>

      <section className="feed">
        <div className="card">
          <div className="asset-list">
            {assets.map((asset) => (
              <Link className="asset-row" key={asset.id} href={`/asset/${asset.symbol}`}>
                <span>
                  <strong>{synthetic(asset.symbol)}</strong>
                  <br />
                  <span className="muted">
                    {asset.symbol} · {asset.name}
                  </span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <strong>{price(asset.price)}</strong>
                  <br />
                  <span className="muted">
                    {asset.priceKnown
                      ? `${asset.tradeCount} trades · ${asset.traderCount} accounts`
                      : "price not read yet"}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="panel disclosure">
          <strong>All five are synthetic.</strong> They track a real company&apos;s
          price through a token this program mints. Holding one is not holding stock,
          and none of them entitle you to anything a share would.
        </div>
      </section>
    </>
  );
}
