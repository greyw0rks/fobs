import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { ShareActions } from "@/components/ShareActions";
import { Reveal } from "@/components/fobs/motion";
import { getTrade } from "@/lib/server/queries";
import { money, price, qty } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * A shareable trade card.
 *
 * The one dark, editorial surface in the product — built to leave the app (a
 * screenshot, a link) and still read as fobs. It carries only what was actually
 * recorded: who traded, the asset, the size, and the fill price. No invented
 * percentage change, because a single trade has no "return" to state — the
 * honest figure is what it filled at.
 *
 * Standalone, outside the app shell: a card to look at and share, not a page to
 * navigate from.
 */
export default async function ShareTradePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trade = await getTrade(id, null);
  if (!trade) notFound();

  const verb = trade.side === "sell" ? "sold" : "bought";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f3ef] p-5">
      <Reveal className="w-full max-w-[520px]">
        <div className="mb-4 text-center">
          <span className="text-xs text-[#777872]">Share your trade</span>
        </div>

        <div className="relative overflow-hidden rounded-[28px] bg-[#111312] p-7 text-white shadow-2xl">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#3175c6] opacity-40 blur-3xl" aria-hidden="true" />
          <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-[#a98ad4] opacity-30 blur-3xl" aria-hidden="true" />

          <div className="relative">
            <div className="flex items-center justify-between">
              <span className="text-xl font-bold tracking-[-0.06em]">fobs</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[10px]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#62c795]" />
                Mainnet
              </span>
            </div>

            <div className="mt-14">
              <p className="text-xs text-white/50">
                {trade.user.displayName} {verb}
              </p>

              <div className="mt-2 flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-sm font-bold tabular-nums text-black">
                  {trade.asset.symbol.slice(0, 2)}
                </div>
                <div>
                  <h1 className="text-[38px] font-semibold tracking-[-0.06em] tabular-nums">
                    {trade.asset.symbol}
                  </h1>
                  <p className="text-xs text-white/50">{trade.asset.name}</p>
                </div>
              </div>

              <div className="mt-12">
                <span className="text-xs text-white/50">Size</span>
                <p className="mt-1 text-[34px] font-semibold tabular-nums">
                  {money(trade.amountUsdc)}
                </p>
                <p className="mt-1 text-sm text-white/60 tabular-nums">
                  {qty(trade.quantity)} at {price(trade.price)}
                </p>
              </div>
            </div>

            <div className="mt-14 flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold">FOMO this.</p>
                <p className="mt-1 text-[10px] text-white/40">People. Markets. FOMO.</p>
              </div>
              <div className="text-[10px] text-white/40">fobs</div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-center">
          <ShareActions />
        </div>

        <div className="mt-4 text-center">
          <Link
            href={`/asset/${trade.asset.symbol}` as Route}
            className="text-xs text-[#777872] hover:text-[#111312]"
          >
            ← Back to {trade.asset.symbol}
          </Link>
        </div>
      </Reveal>
    </main>
  );
}
