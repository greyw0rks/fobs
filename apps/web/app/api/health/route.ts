import { NextResponse } from "next/server";

/**
 * Liveness.
 *
 * This used to report `mode: "demo" | "live"`, which was true when there was a
 * simulated trading path to be in or out of. There is not one any more — every
 * trade is a real devnet transaction — so the field could only ever say "demo",
 * which is precisely the claim this product must never make. Removed rather
 * than left to go stale.
 */
export async function GET() {
  return NextResponse.json({ ok: true, service: "fobs-web" });
}
