import Link from "next/link";
import { listAssets } from "@/lib/server/queries";
import { currentUser } from "@/lib/server/session";
import { price, synthetic } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The landing page.
 *
 * The spec is explicit that this does not open with "Sign in with X" — it opens
 * with what the product is. Sign-in is offered twice, both times after the page
 * has already made its argument, and the primary call to action goes straight to
 * the feed, which is readable without an account.
 */
export default async function LandingPage() {
  const [assets, viewer] = await Promise.all([listAssets(), currentUser()]);

  return (
    <div className="landing">
      <header className="hero">
        <div className="brand">
          <span className="mark">F</span>
          <span>
            <h1>FOBS</h1>
            <p>The social stock market for Solana</p>
          </span>
        </div>
        <nav className="row">
          <Link className="secondary" href="/stocks">
            Markets
          </Link>
          {viewer ? (
            <Link className="button" href="/feed">
              Open the feed
            </Link>
          ) : (
            <Link className="secondary" href="/sign-in">
              Sign in
            </Link>
          )}
        </nav>
      </header>

      <section className="hero-body">
        <h2>See what your people are buying.</h2>
        <p>
          A feed of real trades by the accounts you follow, settled on Solana. When
          someone you follow takes a position you can FOMO it — which places your
          own trade, at your own size, signed by you.
        </p>
        <div className="row">
          <Link className="button" href="/feed">
            Open the feed
          </Link>
          <Link className="secondary" href="/stocks">
            Browse markets
          </Link>
        </div>
      </section>

      <section className="landing-section">
        <h3>How it works</h3>
        <ol className="steps">
          <li>
            <strong>Someone trades.</strong> A wallet signs a real transaction
            against the program&apos;s vault. It settles on devnet in about a second.
          </li>
          <li>
            <strong>The receipt is indexed.</strong> The trade creates a receipt
            account on chain. Our indexer reads it and turns it into a row in
            Postgres — the feed you are looking at is a view of those receipts.
          </li>
          <li>
            <strong>You see it.</strong> If you follow them, it appears in your feed
            and you get a notification, live.
          </li>
          <li>
            <strong>You FOMO it.</strong> Not a copy. Your own trade, your own size,
            your own signature — with a link back to the trade that inspired it.
          </li>
        </ol>
      </section>

      <section className="landing-section">
        <h3>Social trading, not copy trading</h3>
        <p className="muted">
          FOMO records provenance and nothing else. We never mirror an order, never
          take custody, and never sign for you. The trade that lands in your account
          is yours: the program prices it from the oracle, and you choose the size.
        </p>
      </section>

      <section className="landing-section">
        <h3>Markets</h3>
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
                  {asset.priceKnown ? `${asset.tradeCount} trades` : "price not read"}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="landing-section disclosure">
        <h3>These are synthetic assets</h3>
        <p>
          Every symbol on this page — <code>sNVDA</code>, <code>sAAPL</code>,{" "}
          <code>sMSFT</code>, <code>sTSLA</code>, <code>sAMZN</code> — is a token
          minted by this program that <em>tracks</em> a company&apos;s price. None of
          them is stock. None confers ownership, voting rights, or dividends, and
          none is redeemable for a share. They are redeemable only for the test USDC
          in the program&apos;s vault, at the oracle price.
        </p>
        <p>
          This is a devnet deployment. The USDC is a test mint with no value, and
          prices come from an admin-controlled oracle because no Pyth US-equity feed
          is published to devnet — a limitation we measured rather than assumed.
        </p>
      </section>

      <section className="landing-section">
        <h3>Start</h3>
        <p className="muted">
          The feed is readable without an account. Sign in with X only when you want
          to follow people or trade.
        </p>
        <div className="row">
          <Link className="button" href="/feed">
            Open the feed
          </Link>
          <Link className="secondary" href="/sign-in">
            Sign in with X
          </Link>
        </div>
      </section>

      {/* The full version of everything above, including the custody
          arrangement, which this summary deliberately does not try to compress
          into one sentence. */}
      <footer className="landing-section muted">
        <Link href="/terms">Terms and full disclosure</Link> ·{" "}
        <Link href="/dev">/dev harness</Link>
      </footer>
    </div>
  );
}
