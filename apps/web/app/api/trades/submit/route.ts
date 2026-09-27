import { NextResponse } from "next/server";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { connection } from "@/lib/solana/config";
import { tradeableFor } from "@/lib/server/tradeable";
import { recordSwapTrade } from "@/lib/server/record-trade";
import { getTrade } from "@/lib/server/queries";
import { currentUser } from "@/lib/server/session";
import { resolveUserByAddress } from "@/lib/server/wallets";
import { RULES, enforce } from "@/lib/server/rate-limit";
import { tradeErrorResponse } from "@/lib/server/trade-errors";

export const dynamic = "force-dynamic";
/** Send, confirm, then record the swap. */
export const maxDuration = 60;

const SubmitBody = z.object({
  /** base64 VersionedTransaction, already signed by the browser wallet. */
  transaction: z.string().min(1),
  /** The tradeable key `/prepare` returned — resolved again here, not trusted blind. */
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  /** USD moved. Buy: spent. Sell: received. From the prepared quote. */
  amountUsdc: z.number().positive(),
  /** Whole tokens, the fee-adjusted figure from the prepared quote. */
  quantity: z.number().positive(),
  /** USD per token. */
  price: z.number().positive(),
  /** From `/prepare`: the block height the swap's blockhash dies at. */
  lastValidBlockHeight: z.number().int().positive().nullish(),
  sourceTradeId: z.string().min(1).nullish()
});

/**
 * Send a Jupiter swap the user's own wallet signed, then record it.
 *
 * FOBS holds no key, so it signs nothing here — the signature was made in the
 * browser and is already in the transaction. This route is the authorisation
 * boundary, and the boundary is one check: **the transaction's fee payer must be
 * a wallet that belongs to the signed-in user.**
 *
 * On the synthetic path that check read a `TradeReceipt` account's `owner` field
 * off the chain. A swap has no such account, so the fee payer — `staticAccountKeys[0]`
 * of a v0 message, which Jupiter set to the wallet `/prepare` built for — is what
 * stands in. Without it a user could submit a swap built for someone else and
 * have this server record it against themselves; the wallet could not actually
 * sign it, but the trade row would still be a lie. The address is matched through
 * `resolveUserByAddress`, so a trade from a linked second wallet still counts.
 *
 * The trade's economics (`quantity`, `price`) come from the prepared quote the
 * client echoes back. They are keyed to the confirmed signature, so they cannot
 * be recorded for a swap that did not land — parsing the confirmed balance
 * deltas to re-derive them from the chain is a worthwhile hardening, noted here
 * rather than done.
 */
export async function POST(request: Request) {
  const viewer = await currentUser();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limited = enforce(request, viewer.id, RULES.trade);
  if (limited) return limited;

  const parsed = SubmitBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(
      Uint8Array.from(Buffer.from(parsed.data.transaction, "base64"))
    );
  } catch {
    return NextResponse.json(
      { error: "That transaction could not be decoded.", code: "bad_transaction" },
      { status: 400 }
    );
  }

  // --- The authorisation ------------------------------------------------------
  const feePayer = transaction.message.staticAccountKeys[0];
  if (!feePayer) {
    return NextResponse.json({ error: "That transaction names no fee payer." }, { status: 400 });
  }
  const owner = await resolveUserByAddress(feePayer.toBase58());
  if (!owner || owner.id !== viewer.id) {
    return NextResponse.json(
      {
        error: "That transaction is paid by a wallet that does not belong to this account.",
        code: "wallet_not_yours"
      },
      { status: 403 }
    );
  }
  // The wallet must actually have signed — a transaction with an empty first
  // signature is unsigned, and sending it would just fail after we recorded it.
  const firstSig = transaction.signatures[0];
  if (!firstSig || firstSig.every((byte) => byte === 0)) {
    return NextResponse.json(
      { error: "That transaction is not signed.", code: "unsigned" },
      { status: 400 }
    );
  }

  // Resolved here, not trusted from the body, so a client cannot record a
  // different asset than the mint it actually swapped. Resolved *before* sending
  // so the same row is used for the duplicate guard below and the record after.
  const asset = await tradeableFor(parsed.data.symbol);

  // --- The double-execution guard --------------------------------------------
  // A confirmation false-negative (the swap landed, but confirming it timed out)
  // makes the client re-prepare and re-sign — a *new* signature for the same
  // intent, which the signature-keyed idempotency in `recordSwapTrade` cannot
  // catch. So before sending a second real swap, refuse one that matches a trade
  // this account already landed moments ago: same wallet, same mint, same side,
  // same size within a small tolerance. A trade row exists only once a prior
  // swap confirmed, so this never blocks a genuine first attempt or a retry of
  // one that failed — only a duplicate of one that actually went through.
  const DEDUPE_WINDOW_MS = Number(process.env.TRADE_DEDUPE_WINDOW_MS ?? 45_000);
  const existingAsset = await prisma.asset.findUnique({
    where: { mintAddress: asset.mint },
    select: { id: true }
  });
  if (existingAsset) {
    const recent = await prisma.trade.findFirst({
      where: {
        userId: viewer.id,
        assetId: existingAsset.id,
        side: parsed.data.side,
        tradedAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) }
      },
      orderBy: { tradedAt: "desc" },
      select: { id: true, amountUsdc: true }
    });
    const priorUsd = recent ? Number(recent.amountUsdc) : 0;
    const withinTolerance =
      priorUsd > 0 &&
      Math.abs(priorUsd - parsed.data.amountUsdc) <= priorUsd * 0.02;
    if (recent && withinTolerance) {
      return NextResponse.json(
        {
          error:
            "A matching trade just went through moments ago. Check your portfolio before trading again — this one was not sent to avoid a duplicate.",
          code: "duplicate_recent",
          tradeId: recent.id
        },
        { status: 409 }
      );
    }
  }

  const conn = connection();

  let signature: string;
  try {
    signature = await conn.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed"
    });
  } catch (error) {
    // A new blockhash changes the message and invalidates the browser's
    // signature, so this cannot be retried here — the client has to re-prepare.
    if (/blockhash not found/i.test((error as Error)?.message ?? "")) {
      return NextResponse.json(
        {
          error: "The blockhash expired before the transaction was submitted. Sign it again.",
          code: "blockhash_stale"
        },
        { status: 409 }
      );
    }
    const logs = (error as { logs?: string[] }).logs;
    if (logs?.length) console.error(`Submit failed:\n${logs.join("\n")}`);
    return tradeErrorResponse(error);
  }

  try {
    // Confirm against the block height the swap's blockhash dies at, not the
    // deprecated single-arg form whose timeout could not tell "expired" from
    // "still pending." A timeout here (TransactionExpiredBlockheightExceeded)
    // means the blockhash is dead, so a re-sign is safe — but the swap could
    // have landed just before expiry, so a definitive on-chain status check
    // stands between a timeout and telling the client to sign again.
    const blockhash = transaction.message.recentBlockhash;
    const lastValidBlockHeight = parsed.data.lastValidBlockHeight ?? null;

    let landedErr: unknown = null;
    let onChain = false;
    try {
      const confirmation =
        lastValidBlockHeight !== null
          ? await conn.confirmTransaction(
              { signature, blockhash, lastValidBlockHeight },
              "confirmed"
            )
          : await conn.confirmTransaction(signature, "confirmed");
      onChain = true;
      landedErr = confirmation.value.err;
    } catch {
      // Not proof of failure. Ask the chain directly whether it landed.
      const status = await conn.getSignatureStatus(signature, {
        searchTransactionHistory: true
      });
      const value = status.value;
      const settled =
        value?.confirmationStatus === "confirmed" ||
        value?.confirmationStatus === "finalized";
      if (value && settled) {
        onChain = true;
        landedErr = value.err;
      }
    }

    if (!onChain) {
      // Genuinely not on chain and the blockhash is dead — safe to re-sign.
      return NextResponse.json(
        {
          error: "The transaction expired before it landed. Sign it again.",
          code: "blockhash_stale"
        },
        { status: 409 }
      );
    }
    if (landedErr) {
      return NextResponse.json(
        {
          error: `Swap ${signature} failed on chain: ${JSON.stringify(landedErr)}`
        },
        { status: 400 }
      );
    }

    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: viewer.id },
      select: { username: true, displayName: true }
    });

    const { id } = await recordSwapTrade({
      userId: viewer.id,
      username: actor.username,
      displayName: actor.displayName,
      asset,
      side: parsed.data.side,
      amountUsdc: parsed.data.amountUsdc,
      quantity: parsed.data.quantity,
      price: parsed.data.price,
      signature,
      sourceTradeId: parsed.data.sourceTradeId ?? null
    });

    return NextResponse.json(
      { trade: await getTrade(id, viewer.id), signature },
      { status: 201 }
    );
  } catch (error) {
    return tradeErrorResponse(error);
  }
}
