import type { Route } from "next";
import Link from "next/link";
import { MarketsTable } from "@/components/fobs/markets-table";
import { Reveal } from "@/components/fobs/motion";
import { listAssets } from "@/lib/server/queries";
import { changesForSymbols } from "@/lib/server/price-history";

export const dynamic = "force-dynamic";

/**
 * The market list.
 *
 * MarketsTable owns the honesty rules: a null price renders an em dash, and the
 * 1D column is a real close-to-close change (null → em dash) — the only
 * green/red on the page. The 1D figures come from changesForSymbols, which reads
 * real history per symbol and returns null where it has none.
 */
export default async function StocksPage() {
  const assets = await listAssets();
  const changes = await changesForSymbols(assets.map((a) => a.symbol));

  const indexedTrades = assets.reduce((total, asset) => total + asset.tradeCount, 0);

  return (
    <div className="space-y-5">
      <Reveal>
        <section>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#898a84]">
            Solana mainnet
          </span>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.05em]">Markets</h1>
          <p className="mt-1 text-sm text-[#777872]">
            {assets.length} real mainnet {assets.length === 1 ? "token" : "tokens"},{" "}
            {indexedTrades} {indexedTrades === 1 ? "trade" : "trades"}. Each price is read
            live — a Jupiter route or a Pyth reference — not from anything fobs controls.
          </p>
        </section>
      </Reveal>

      <Reveal delay={0.05}>
        <MarketsTable
          assets={assets}
          changes={changes}
          title="Markets"
          subtitle="What people are trading"
        />
      </Reveal>

      <Reveal delay={0.1} className="fobs-surface p-5 text-xs leading-relaxed text-[#777872]">
        <strong className="font-semibold text-[#111312]">fobs issues none of these.</strong>{" "}
        Each is a real token that already trades on Solana mainnet, reached through a
        Jupiter swap your own wallet signs. A tokenized equity is not the share itself —
        issuer terms, liquidity, and price dislocation are real risks — so read{" "}
        <Link href={"/terms" as Route} className="font-medium text-[#3175c6]">
          the full disclosure
        </Link>{" "}
        before you trade.
      </Reveal>
    </div>
  );
}
