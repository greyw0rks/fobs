import { NextResponse } from "next/server";
import { z } from "zod";
import { getTrade } from "@/lib/server/queries";
import { currentUserOrDevFallback } from "@/lib/server/session";
import { executeTradeAsTestUser } from "@/lib/server/execute-trade";
import { tradeErrorResponse } from "@/lib/server/trade-errors";
import { RULES, enforce } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
/** A trade is a devnet round trip: build, send, confirm, re-index. */
export const maxDuration = 60;

const TradeBody = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  amountUsdc: z.number().positive().max(100_000)
});

export async function POST(request: Request) {
  const viewer = await currentUserOrDevFallback();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Each of these sends a real devnet transaction and spends real (if worthless)
  // SOL, so an unbounded loop here costs the operator money, not just bandwidth.
  const limited = enforce(request, viewer.id, RULES.trade);
  if (limited) return limited;

  const parsed = TradeBody.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const { tradeId, signature, receipt } = await executeTradeAsTestUser({
      username: viewer.username,
      symbol: parsed.data.symbol,
      side: parsed.data.side,
      amountUsdc: parsed.data.amountUsdc
    });
    return NextResponse.json(
      { trade: await getTrade(tradeId, viewer.id), signature, receipt },
      { status: 201 }
    );
  } catch (error) {
    return tradeErrorResponse(error);
  }
}
