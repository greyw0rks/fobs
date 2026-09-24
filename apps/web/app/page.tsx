import Link from "next/link";
import type { Route } from "next";
import { SiteNav } from "@/components/SiteNav";
import { MarketsTable } from "@/components/fobs/markets-table";
import { Reveal, Stagger, StaggerItem } from "@/components/fobs/motion";
import { listAssets } from "@/lib/server/queries";
import { changesForSymbols } from "@/lib/server/price-history";
import { currentUser } from "@/lib/server/session";
import { price } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The landing page.
 *
 * Editorial, full-bleed, on the warm canvas: a large lowercase-"fobs" hero, a
 * floating product card built from real priced assets, a three-card feature
 * row, and — the only place a visitor sees the thing working before they have an
 * account — a live markets board read from the indexer.
 *
 * Every figure is real: market/trade/priced counts are read from `listAssets`,
 * and the board's 1D change is a real close-to-close move (null renders as an em
 * dash). No invented percentages anywhere.
 */
export default async function LandingPage() {
  const [assets, viewer] = await Promise.all([listAssets(), currentUser()]);
  const changes = await changesForSymbols(assets.map((asset) => asset.symbol));

  const indexedTrades = assets.reduce((total, asset) => total + asset.tradeCount, 0);
  const priced = assets.filter((asset) => asset.priceKnown);

  return (
    <main className="min-h-screen bg-[#f4f3ef] text-[#111312]">
      <SiteNav
        action={
          viewer
            ? { href: "/feed", label: "Open the feed" }
            : { href: "/feed", label: "Enter the feed" }
        }
      />

      {/* Hero */}
      <Reveal>
        <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute right-[4%] top-[-40px] h-[520px] w-[520px] rounded-full bg-[#dfeafa] blur-3xl" />
        <div className="pointer-events-none absolute right-[12%] top-[140px] h-[340px] w-[340px] rounded-full bg-[#eadcf5] blur-3xl" />

        <div className="relative mx-auto grid max-w-[1400px] items-center gap-16 px-6 pb-20 pt-16 lg:grid-cols-[0.95fr_1.05fr] lg:px-10 lg:pt-24">
          <div className="max-w-[620px]">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#3175c6]">
              Social stock market
            </p>

            <h1 className="text-[52px] font-semibold leading-[0.96] tracking-[-0.065em] sm:text-[68px] lg:text-[82px]">
              Trade what
              <br />
              your friends trade.
            </h1>

            <p className="mt-7 max-w-[500px] text-base leading-7 text-[#6e6f69] sm:text-lg">
              A social stock market built around people, markets and FOMO. Real
              tokenized equities on Solana mainnet — listed and pre-IPO — in one
              place. Every trade is a swap your own wallet signs.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={"/feed" as Route} className="fobs-button-primary px-6 py-3">
                Start trading →
              </Link>
              <Link href={"/sign-in" as Route} className="fobs-button-secondary px-6 py-3">
                Sign in
              </Link>
            </div>

            <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-[#8b8c85]">Markets</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-[-0.04em]">{assets.length}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-[#8b8c85]">Trades indexed</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-[-0.04em]">{indexedTrades}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-[#8b8c85]">Prices live</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-[-0.04em]">{priced.length}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-[#8b8c85]">Settlement</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Mainnet</dd>
              </div>
            </dl>
          </div>

          <HeroProduct assets={priced} />
        </div>
      </section>
      </Reveal>

      {/* Feature row */}
      <Reveal delay={0.05}>
        <section className="mx-auto max-w-[1400px] px-6 pb-16 lg:px-10">
          <Stagger className="grid gap-3 sm:grid-cols-3">
            {[
              ["Real market data", "Live prices, read from mainnet — never invented."],
              ["Follow your friends", "See what your people are actually buying."],
              ["FOMO", "Your own trade, at your own size and signature."]
            ].map(([title, text]) => (
              <StaggerItem key={title} className="rounded-[18px] border border-[#e3e2dc] bg-white p-6">
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-2 text-xs leading-5 text-[#777872]">{text}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      </Reveal>

      {/* Live markets board — real state from the indexer */}
      <Reveal delay={0.1}>
        <section id="markets" className="mx-auto max-w-[1400px] px-6 pb-16 lg:px-10">
        <div className="mb-5 max-w-[620px]">
          <h2 className="text-xl font-semibold tracking-[-0.04em]">Live markets</h2>
          <p className="mt-2 text-sm leading-6 text-[#6e6f69]">
            Every figure below is read live from mainnet — a Jupiter route or a
            Pyth reference. Where a price has not been read, the row says so
            rather than showing a placeholder.
          </p>
        </div>

        <MarketsTable
          assets={assets}
          changes={changes}
          title="Live markets"
          subtitle="What people are trading on mainnet"
        />
        </section>
      </Reveal>

      {/* How it works */}
      <Reveal delay={0.15}>
        <section id="how" className="mx-auto max-w-[1400px] px-6 pb-16 lg:px-10">
        <div className="mb-6 max-w-[620px]">
          <h2 className="text-xl font-semibold tracking-[-0.04em]">How it works</h2>
          <p className="mt-2 text-sm leading-6 text-[#6e6f69]">
            Nothing here is simulated. A trade is a real swap your own wallet
            signs on mainnet, and the feed is a view of the trades that leaves
            behind.
          </p>
        </div>

        <ol className="grid list-none gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Someone trades", "Their wallet signs a swap into a real mainnet token. FOBS routes it and never signs."],
            ["It is recorded", "The confirmed swap becomes a feed row, keyed to its transaction signature. No custody."],
            ["You see it", "If you follow them it appears in your feed, and you get a notification, live."],
            ["You FOMO it", "Not a copy. Your own swap, your own size, your own signature — linked back to the original."]
          ].map(([title, text], i) => (
            <li
              key={title}
              className="rounded-[18px] border border-[#e3e2dc] bg-white p-5"
            >
              <span className="text-[11px] font-semibold tabular-nums text-[#3175c6]">
                0{i + 1}
              </span>
              <h3 className="mt-3 text-sm font-semibold">{title}</h3>
              <p className="mt-2 text-xs leading-5 text-[#777872]">{text}</p>
            </li>
          ))}
        </ol>
      </section>
      </Reveal>

      {/* Disclosure */}
      <Reveal delay={0.2}>
        <section className="mx-auto max-w-[1400px] px-6 pb-16 lg:px-10">
        <div className="rounded-[18px] border border-[#e3e2dc] bg-[#eeeee9] p-6 text-sm leading-6 text-[#5c5d57]">
          <strong className="text-[#111312]">FOBS issues none of these tokens.</strong>{" "}
          Every symbol here is a real token that already trades on Solana mainnet
          — a Backed xStock like <code className="font-mono">NVDAx</code>, a
          PreStocks pre-IPO name like <code className="font-mono">SPACEX</code>,
          or an Ondo equity. FOBS mints nothing, burns nothing, and holds no key:
          a trade is a Jupiter swap your own wallet signs, quoted against the real
          USDC mint. Tokenized equity carries real risk. See{" "}
          <Link href={"/terms" as Route} className="text-[#3175c6] underline">
            the full disclosure
          </Link>
          .
        </div>
      </section>
      </Reveal>

      {/* Footer */}
      <footer className="border-t border-[#e3e2dc]">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-6 py-8 text-xs text-[#777872] sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <span className="max-w-[560px]">
            fobs — a bridge into real markets on Solana mainnet. It issues nothing
            and signs nothing.
          </span>
          <nav className="flex flex-wrap gap-5">
            <Link href={"/stocks" as Route} className="hover:text-[#111312]">Markets</Link>
            <Link href={"/feed" as Route} className="hover:text-[#111312]">Feed</Link>
            <Link href={"/terms" as Route} className="hover:text-[#111312]">Terms</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

/**
 * A floating product card — the market board a visitor can read before they
 * have an account, framed as the app's own surface hovering inside the soft
 * environment. Fed with real priced assets; shows nothing invented.
 */
function HeroProduct({ assets }: { assets: Awaited<ReturnType<typeof listAssets>> }) {
  const rows = assets.slice(0, 5);
  return (
    <div className="relative min-h-[420px] lg:min-h-[520px]">
      <div className="absolute inset-6 rounded-[40px] bg-gradient-to-br from-[#dceafa] via-[#e9ddf5] to-[#f5ddd2] blur-xl" />

      <div className="relative mx-auto max-w-[500px] rotate-[2deg] rounded-[28px] border border-white bg-white/90 p-5 shadow-[0_30px_80px_rgba(0,0,0,.08)] backdrop-blur">
        <div className="mb-6 flex items-center justify-between">
          <span className="text-lg font-bold tracking-[-0.05em]">fobs</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#edf5ef] px-3 py-1 text-[10px] text-[#23845b]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#23845b]" />
            Mainnet
          </span>
        </div>

        <div className="rounded-2xl bg-[#f5f4ef] p-4">
          <span className="text-[10px] uppercase tracking-wide text-[#8b8c85]">Live prices</span>
          <div className="mt-3 space-y-3">
            {rows.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#85867f]">
                No live prices read yet.
              </p>
            ) : (
              rows.map((asset) => (
                <div key={asset.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-[10px] font-bold">
                      {asset.symbol.slice(0, 2)}
                    </div>
                    <div>
                      <div className="text-xs font-semibold">{asset.symbol}</div>
                      <div className="text-[10px] text-[#92938c]">{asset.name}</div>
                    </div>
                  </div>
                  <span className="text-xs font-medium tabular-nums">{price(asset.price)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
