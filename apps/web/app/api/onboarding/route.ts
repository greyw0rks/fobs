import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { custodyConfigured } from "@/lib/server/custody";
import { ensureWallet } from "@/lib/server/onboarding";
import { RULES, enforce } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
/** Creating and funding a wallet is two devnet round trips plus an airdrop. */
export const maxDuration = 60;

/**
 * Create this user's devnet wallet, on their say-so.
 *
 * This is the consented step. It used to happen silently inside the X callback,
 * which meant a wallet and a funded balance appeared as a side effect of signing
 * in — the user never agreed to anything and was never told. Now the callback
 * redirects here and this route only runs when someone presses the button, so
 * the page can say what is about to be made before it is made.
 *
 * It is still safe to call more than once, and `signerForUsername` still calls
 * `ensureWallet` on the first trade. Consent is about the user knowing what
 * happened, not about making the system fragile for someone who reloaded the
 * page at the wrong moment.
 */
export async function POST(request: Request) {
  const viewer = await currentUser();
  if (!viewer) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const limited = enforce(request, viewer.id, RULES.onboarding);
  if (limited) return limited;

  if (!custodyConfigured()) {
    return NextResponse.json(
      {
        error:
          "This deployment has no custody key, so it cannot create a wallet. " +
          "Set FOBS_CUSTODY_SECRET."
      },
      { status: 503 }
    );
  }

  try {
    const result = await ensureWallet(viewer.id);
    return NextResponse.json(
      { ...result, created: result.created },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    console.error("[fobs] onboarding failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Onboarding failed." },
      { status: 500 }
    );
  }
}
