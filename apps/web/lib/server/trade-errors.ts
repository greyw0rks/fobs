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
 */
export function tradeErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  const insufficient = /insufficient|0x1772|InsufficientFunds/i.test(message);
  const badRequest = /InvalidAmount|not found|no wallet|must be positive/i.test(message);

  const status = insufficient ? 402 : badRequest ? 400 : 502;
  return NextResponse.json({ error: message, retryable: status === 502 }, { status });
}
