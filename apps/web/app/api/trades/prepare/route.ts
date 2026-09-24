import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { usdcMint, DECIMALS } from "@/lib/solana/config";
import { tradeableFor, type Tradeable } from "@/lib/server/tradeable";
import { buildSwapTransaction, quoteSwap } from "@/lib/server/quote";
import { checkDeviation, impliedPrice } from "@/lib/server/deviation";
import { referencePrice } from "@/lib/server/pyth-reference";
import { fetchPreStock } from "@/lib/server/prestocks";
import { currentUser } from "@/lib/server/session";
import { primaryAddress } from "@/lib/server/wallets";
import { RULES, enforce } from "@/lib/server/rate-limit";
import { tradeErrorResponse } from "@/lib/server/trade-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PrepareBody = z.object({
  /** A tradeable key: a listed ticker (NVDA), `NVDA-ondo`, or a PreStocks name. */
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  /** For a buy: USD of USDC spent. For a sell: the USD figure the UI showed. */
  amountUsdc: z.number().positive().max(100_000),
  /** Token base units to sell. Required for a sell, ignored for a buy. */
  amountTokens: z.string().regex(/^\d+$/).nullish(),
  sourceTradeId: z.string().min(1).nullish()
});

const USDC_BASE = 10 ** DECIMALS;

/**
 * Build a Jupiter swap for the user's *own* wallet to sign.
 *
 * FOBS is a bridge, so a "trade" is a swap of real mainnet tokens, not a mint of
 * something this app issues. The route resolves the asset to a real mint, quotes
 * it through Jupiter net of the Token-2022 transfer fee, checks a listed equity
 * against its Pyth reference, and returns an unsigned transaction. Nothing is
 * signed and nothing is sent here — the browser wallet signs, `/submit` sends,
 * and no key ever touches this server.
 *
 * The owner comes from `primaryAddress(viewer.id)`, never the request body: the
 * swap moves tokens between *that* wallet's accounts, so building it for anyone
 * else would be building a transaction to spend someone else's balance. The
 * program-level signature check that used to backstop this is gone — a Jupiter
 * swap is a plain transfer — so this route is now the only thing enforcing it.
 */
export async function POST(request: Request) {
  const viewer = await currentUser();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limited = enforce(request, viewer.id, RULES.trade);
  if (limited) return limited;

  const parsed = PrepareBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { amountUsdc, amountTokens, sourceTradeId } = parsed.data;
  let { symbol, side } = parsed.data;

  try {
    const address = await primaryAddress(viewer.id);
    if (!address) {
      return NextResponse.json(
        {
          error: "This account has no wallet yet. Connect one before trading.",
          code: "wallet_required"
        },
        { status: 400 }
      );
    }
    const owner = new PublicKey(address);

    // Provenance, DB-only now: a FOMO follows someone into a position, so the
    // asset comes from the source trade rather than the request, and the side is
    // forced to buy. There is no on-chain receipt to point at any more — the edge
    // lives in our own table, not on the chain.
    if (sourceTradeId) {
      const source = await prisma.trade.findUnique({
        where: { id: sourceTradeId },
        select: { asset: { select: { symbol: true } } }
      });
      if (!source) {
        return NextResponse.json({ error: "No such trade to FOMO." }, { status: 404 });
      }
      symbol = source.asset.symbol;
      side = "buy";
    }

    const asset = await tradeableFor(symbol);

    // Direction decides which mint moves in. A buy spends USDC; a sell spends the
    // token. A sell is sized in the token's own base units — either given
    // explicitly (`amountTokens`, e.g. "sell my whole position") or derived from
    // the USD figure the user typed, using the token's own price. Deriving it
    // here rather than on the client keeps the price server-side, where the
    // deviation guard reads it from too.
    const isBuy = side === "buy";
    const inputMint = isBuy ? usdcMint().toBase58() : asset.mint;
    const outputMint = isBuy ? asset.mint : usdcMint().toBase58();

    let amount: bigint;
    if (isBuy) {
      amount = BigInt(Math.round(amountUsdc * USDC_BASE));
    } else if (amountTokens) {
      amount = BigInt(amountTokens);
    } else {
      const px = await sellSizingPrice(asset);
      const tokens = amountUsdc / px;
      amount = BigInt(Math.round(tokens * 10 ** asset.decimals));
      if (amount <= 0n) {
        return NextResponse.json(
          { error: "That is too small to sell at the current price.", code: "amount_too_small" },
          { status: 400 }
        );
      }
    }

    const quote = await quoteSwap({ inputMint, outputMint, amount, policy: asset.policy });

    // The Pyth guard, carried into execution. For a listed equity the venue's
    // implied price is checked against the reference and a dislocated route is
    // refused — the same guard the surface shows, now blocking a real trade. A
    // pre-IPO name has no reference, so there is nothing to check and the trade
    // proceeds with that stated rather than a guard invented.
    let deviation = null;
    if (asset.referenceSymbol) {
      const tokenDecimals = asset.decimals;
      const tokenUnits = isBuy
        ? Number(quote.outAmount) / 10 ** tokenDecimals
        : Number(quote.inAmount) / 10 ** tokenDecimals;
      const usd = isBuy ? amountUsdc : Number(quote.outAmount) / USDC_BASE;
      const implied = impliedPrice(usd, tokenUnits);
      const check = await checkDeviation({ symbol: asset.referenceSymbol, impliedPrice: implied });
      deviation = {
        symbol: check.symbol,
        impliedPrice: check.impliedPrice,
        referencePrice: check.reference?.price ?? null,
        deviationBps: check.deviationBps,
        verdict: check.verdict,
        referenceIsLastClose: check.referenceIsLastClose,
        reason: check.reason
      };
      if (!check.allowed) {
        return NextResponse.json(
          {
            error: `Route refused: ${check.reason}`,
            code: "dislocated",
            deviation
          },
          { status: 409 }
        );
      }
    }

    const built = await buildSwapTransaction({ quote, userPublicKey: address });

    return NextResponse.json({
      // A base64 VersionedTransaction, unsigned, fee-payer already the owner —
      // Jupiter set it. The browser signs this exact bytes and posts it back.
      transaction: built.swapTransaction,
      lastValidBlockHeight: built.lastValidBlockHeight,
      owner: address,
      // Our numbers, not the client's — a FOMO's asset/side are resolved here.
      symbol: asset.key,
      displaySymbol: asset.symbol,
      kind: asset.kind,
      side,
      amountUsdc,
      // What the swap actually does, so the UI renders truth rather than intent.
      quote: {
        inAmount: quote.inAmount.toString(),
        quotedOutAmount: quote.quotedOutAmount.toString(),
        outAmount: quote.outAmount.toString(),
        feeAmount: quote.feeAmount.toString(),
        transferFeeBps: quote.transferFeeBps,
        netting: quote.netting,
        venues: quote.venues,
        unverifiedVenues: quote.unverifiedVenues,
        priceImpactPctRaw: quote.priceImpactPctRaw,
        /** The token's decimals, either side of the trade. USDC is always 6. */
        tokenDecimals: asset.decimals
      },
      deviation
    });
  } catch (error) {
    return tradeErrorResponse(error);
  }
}

/**
 * USD per token, used only to size a sell from a USD figure.
 *
 * A listed equity uses its Pyth reference — the same number the guard trusts. A
 * pre-IPO name has no reference, so it uses the issuer's own live token price.
 * This is a *sizing* estimate: the actual fill comes from the quote that follows
 * and may differ by slippage and the transfer fee. It only needs to be close
 * enough to turn "$50" into a token count.
 */
async function sellSizingPrice(asset: Tradeable): Promise<number> {
  if (asset.referenceSymbol) {
    const reference = await referencePrice(asset.referenceSymbol);
    if (reference.price > 0) return reference.price;
  }
  const token = await fetchPreStock(asset.symbol);
  if (token && token.tokenPrice > 0) return token.tokenPrice;
  throw new Error(`no price to size a sell of ${asset.symbol}`);
}
