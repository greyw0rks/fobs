import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { USDC_PER_USER } from "@/lib/server/funding";

export const dynamic = "force-dynamic";

/**
 * Terms and disclosure.
 *
 * One page, and it exists because several things about this product are easy to
 * mistake for something they are not: the prices look like prices, the symbols
 * look like tickers, the USDC has a dollar sign, and the wallet is a wallet. Each
 * of those is a real thing standing in for a fake one, which is the exact shape
 * of a disclosure problem.
 *
 * The asset list is read from the database rather than written out here, so the
 * page cannot go stale when the five tickers change — a disclosure that names
 * the wrong instruments is worse than none.
 */
export default async function TermsPage() {
  const assets = await prisma.asset.findMany({
    orderBy: { onchainId: "asc" },
    select: { symbol: true, name: true, priceFeedType: true, pythFeedId: true }
  });

  const usdc = Number(USDC_PER_USER) / 1e6;

  return (
    <div className="landing">
      <header className="hero">
        <div className="brand">
          <Link className="brand" href="/">
            <span className="mark">F</span>
            <span>
              <h1>FOBS</h1>
              <p>Terms and disclosure</p>
            </span>
          </Link>
        </div>
        <Link className="secondary" href="/feed">
          Back to the feed
        </Link>
      </header>

      <section className="landing-section disclosure">
        <h3>FOBS is not a brokerage, and these are not stocks</h3>
        <p>
          Nothing here is an offer to buy or sell a security. There is no company,
          no share, no dividend, and no ownership of anything. FOBS is a
          demonstration of a social trading loop, running entirely on Solana
          devnet, where nothing has value.
        </p>
      </section>

      <section className="landing-section">
        <h3>Synthetic assets</h3>
        <p className="muted">
          The five instruments below are tokens this program mints. Each one is
          designed to track the price of a real company&apos;s stock. Holding one
          gives you a token and a claim on the program&apos;s vault — nothing else.
          They carry no voting rights, pay no dividend, and cannot be redeemed for
          a real share anywhere.
        </p>
        <div className="asset-list">
          {assets.map((asset) => (
            <div className="asset-row" key={asset.symbol}>
              <span>
                <strong>{asset.name}</strong>
                <br />
                <span className="muted">
                  Ticker <strong>{asset.symbol}</strong>, minted by this program
                </span>
              </span>
              <span className="muted" style={{ textAlign: "right" }}>
                {asset.priceFeedType === "pyth"
                  ? "Pyth oracle"
                  : "Test price feed (no Pyth feed available on devnet)"}
              </span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          Where a symbol carries an <code>s</code> prefix — <code>sNVDA</code>,{" "}
          <code>sAAPL</code> — that prefix is the synthetic marker. It is not part
          of any real ticker.
        </p>
      </section>

      <section className="landing-section">
        <h3>Prices</h3>
        <p className="muted">
          Trades are priced by the program, reading an oracle account on chain —
          never by a number this website sends. On mainnet that feed is Pyth. On
          devnet no US-equity Pyth feed is published, so the program reads a test
          feed instead, and every price in the app is that feed&apos;s value: not a
          live market price, and not necessarily close to one.
        </p>
        <p className="muted">
          The app shows a figure only where one was actually read. Where a price is
          missing it says so rather than showing a placeholder, and it does not
          compute a gain, a loss, or a percentage change from a price it does not
          have.
        </p>
      </section>

      <section className="landing-section">
        <h3>Test USDC</h3>
        <p className="muted">
          Balances shown as USDC are a test token this program mints, funded at up
          to {usdc.toLocaleString()} per account. It is not Circle USDC, it is not
          backed by dollars, and it cannot be withdrawn, sold, or transferred for
          value. It exists so there is something to trade with on devnet.
        </p>
      </section>

      <section className="landing-section disclosure">
        <h3>Custody — the part to read twice</h3>
        <p>
          When you create a wallet here, <strong>the server generates the private
          key and keeps it</strong>, encrypted, in this application&apos;s database.
          Trades are signed on the server with that key. This is custodial: the
          operator of this deployment can sign transactions as you, and could move
          anything the wallet holds.
        </p>
        <p>
          That is a deliberate, disclosed choice for a devnet test environment, and
          it is the first thing that would have to change before this held anything
          of value — a product with real money would use a wallet adapter and sign
          in the user&apos;s browser, so no key ever reaches a server. Do not put
          anything that matters into a wallet created here.
        </p>
        <p className="muted">
          Two related things, stated plainly because they are easy to get wrong:
          the wallet-creation step happens on{" "}
          <Link href="/welcome">the setup page</Link>, not as a side effect of
          signing in, and seeded test accounts hold their keys the same way.
        </p>
      </section>

      <section className="landing-section">
        <h3>What FOMO does</h3>
        <p className="muted">
          Pressing FOMO on someone else&apos;s trade places <strong>your own
          trade</strong> — your size, your wallet, your signature, priced at the
          current oracle price. It is not a copy: it will not match their entry
          price, their quantity, or their timing. The only thing carried over is a
          reference to their trade, so both sides can see who inspired whom. You can
          lose money on a FOMO nobody else lost money on, including the person you
          copied.
        </p>
      </section>

      <section className="landing-section">
        <h3>No warranty, no recourse</h3>
        <p className="muted">
          This is software provided as-is, with no warranty of any kind. There is no
          support, no insurance, no dispute process, and no way to recover funds.
          Devnet can be reset by anyone at any time, which would erase balances,
          holdings and history.
        </p>
      </section>

      <section className="landing-section">
        <h3>Accounts and data</h3>
        <p className="muted">
          Signing in with X reads your public profile — your handle, display name
          and avatar — to create an account, and never posts on your behalf and
          never reads your followers, your posts, or your direct messages. Your
          follows, holdings and trade history are stored in this deployment&apos;s
          database and mirrored from public devnet state; they are not sold and not
          shared with anyone.
        </p>
        <p className="muted">
          Test accounts seeded for the demo are publicly listed on{" "}
          <Link href="/sign-in">the sign-in page</Link> so anyone can use them.
          Anything done with a seeded account is visible to everyone and is not
          private.
        </p>
      </section>
    </div>
  );
}
