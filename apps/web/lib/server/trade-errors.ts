import { NextResponse } from "next/server";

/**
 * Turn a failed trade into a response someone can act on.
 *
 * A trade fails at one of three layers, and they need different status codes
 * because they mean different things to the caller:
 *
 *   400  the request was wrong (bad amount, unknown asset)
 *   402  the wallet cannot afford it — a *user* problem, and the only one the
 *        person can fix themselves
 *   502  the chain or the RPC failed — retryable, and not the user's fault
 *
 * The program's own errors arrive as text from the preflight simulation, so the
 * match below is on message content. That is fragile in principle; in practice
 * these messages are stable, and a miss degrades to 502 with the real message
 * attached rather than to a wrong claim.
 *
 * A `SendTransactionError` keeps its detail on `.logs`, not always in `.message`
 * (the whole reason web3.js tells you to call `getLogs()`), so we search both.
 * The single most common failure on a USDC bridge is the wallet having USDC but
 * no SOL: opening the output token's associated account is a `SystemProgram`
 * transfer to rent-exemption, and a wallet short on lamports fails it with the
 * System Program's `0x1`. That reads as a cryptic log dump; we turn it into the
 * one instruction the user can act on — add SOL.
 */
export function tradeErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const logs = (error as { logs?: string[] } | null)?.logs;
  const text = logs?.length ? `${message}\n${logs.join("\n")}` : message;

  // "insufficient lamports X, need Y" is the System Program funding an account
  // (an ATA's rent) it cannot cover. "insufficient funds for rent" is the same
  // shortfall phrased by the runtime. Either way it is missing SOL, not USDC.
  const lamports = /insufficient lamports\s+(\d+),\s*need\s+(\d+)/i.exec(text);
  const rentShortfall =
    lamports || /insufficient funds for rent|prior to executing/i.test(text);

  if (rentShortfall) {
    const short =
      lamports && Number(lamports[2]) > Number(lamports[1])
        ? (Number(lamports[2]) - Number(lamports[1])) / 1_000_000_000
        : null;
    const gap = short ? ` (about ${short.toFixed(4)} SOL short)` : "";
    return NextResponse.json(
      {
        error:
          `Not enough SOL to cover network fees and the token account this trade opens${gap}. ` +
          "Add a little SOL to your wallet — keep about 0.01 SOL free — and try again. Your USDC is fine.",
        code: "insufficient_sol",
        retryable: false
      },
      { status: 402 }
    );
  }

  // 0x1772 is Anchor's `InsufficientFunds` — here it means the token balance
  // (USDC on a buy, the token on a sell), a different shortfall than SOL above.
  const insufficient = /insufficient|0x1772|InsufficientFunds/i.test(text);
  const badRequest = /InvalidAmount|not found|no wallet|must be positive/i.test(text);

  const status = insufficient ? 402 : badRequest ? 400 : 502;
  return NextResponse.json({ error: message, retryable: status === 502 }, { status });
}
