import { notFound } from "next/navigation";
import { ShareCard } from "@/components/ShareCard";
import { getTrade } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

/**
 * A shareable trade card.
 *
 * The one dark, editorial surface in the product — built to leave the app (a
 * saved image, a link) and still read as fobs. It carries only what was actually
 * recorded: who traded, the asset, the size, and the fill price. No invented
 * percentage change, because a single trade has no "return" to state — the
 * honest figure is what it filled at.
 *
 * The card and its "Save image" action live in the `ShareCard` client component:
 * rasterising the rendered node to a PNG is a browser-only job, so the page
 * stays a thin server shell that fetches the trade and hands it down.
 *
 * Standalone, outside the app shell: a card to look at and save, not a page to
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f3ef] p-5">
      <ShareCard
        trade={{
          id: trade.id,
          side: trade.side,
          amountUsdc: trade.amountUsdc,
          quantity: trade.quantity,
          price: trade.price,
          user: { displayName: trade.user.displayName },
          asset: { symbol: trade.asset.symbol, name: trade.asset.name }
        }}
      />
    </main>
  );
}
