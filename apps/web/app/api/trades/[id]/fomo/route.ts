import { NextResponse } from "next/server";
import { z } from "zod";
import { getTrade } from "@/lib/server/queries";
import { currentUserOrDevFallback } from "@/lib/server/session";
import { executeTradeAsTestUser } from "@/lib/server/execute-trade";
import { tradeErrorResponse } from "@/lib/server/trade-errors";
import { RULES, enforce } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FomoBody = z.object({
  amountUsdc: z.number().positive().max(100_000)
});

/**
 * FOMO a trade.
 *
 * This does not copy the source trade. It reads the source only to learn which
 * *asset* and which *receipt* to reference, then places an entirely separate
 * order at the size the caller asked for, signed by the caller, priced by the
 * program from the oracle. Same asset, different trade.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const viewer = await currentUserOrDevFallback();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Same cost as a plain trade: this signs and sends a real transaction.
  const limited = enforce(request, viewer.id, RULES.fomo);
  if (limited) return limited;

  const { id } = await params;
  const source = await getTrade(id, viewer.id);
  if (!source) {
    return NextResponse.json({ error: "Source trade not found" }, { status: 404 });
  }

  const parsed = FomoBody.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const { tradeId, signature, receipt } = await executeTradeAsTestUser({
      username: viewer.username,
      symbol: source.asset.symbol,
      // A FOMO follows someone into a position. Selling someone else's sell is
      // not the gesture, so this is always a buy.
      side: "buy",
      amountUsdc: parsed.data.amountUsdc,
      sourceTradeId: source.id
    });
    return NextResponse.json(
      { trade: await getTrade(tradeId, viewer.id), signature, receipt },
      { status: 201 }
    );
  } catch (error) {
    return tradeErrorResponse(error);
  }
}
