import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { enforce, RULES } from "@/lib/server/rate-limit";
import { WalletChallengeError, issueChallenge, type NoncePurpose } from "@/lib/server/wallet-auth";

export const dynamic = "force-dynamic";

/**
 * Issue a wallet a challenge to sign.
 *
 * The first half of sign-in-with-Solana, and the same first half of linking a
 * wallet: the difference is the `purpose`, which decides both the wording of the
 * message the user reads in their wallet and what the verification route is
 * allowed to do with the result.
 *
 * `domain` is taken from the request rather than from configuration, because the
 * message states the site the user is signing into — and configuration would be
 * wrong on at least one of the dev server, the tunnel and the deployment. The
 * request's own origin is the only value that is always the one the user is
 * actually looking at.
 *
 * For `link`, the user id comes from the session and never from the body: a
 * caller who could name the account to link to could attach their wallet to
 * somebody else's account.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    address?: unknown;
    purpose?: unknown;
  };

  const viewer = await currentUser();
  const limited = enforce(request, viewer?.id ?? null, RULES.dev);
  if (limited) return limited;

  if (typeof body.address !== "string") {
    return NextResponse.json({ error: "An `address` is required." }, { status: 400 });
  }

  const purpose: NoncePurpose = body.purpose === "link" ? "link" : "sign-in";

  if (purpose === "link" && !viewer) {
    return NextResponse.json(
      { error: "Sign in before linking a wallet.", code: "link_requires_session" },
      { status: 401 }
    );
  }

  try {
    const challenge = await issueChallenge({
      address: body.address,
      purpose,
      userId: purpose === "link" ? viewer!.id : null,
      domain: new URL(request.url).origin
    });

    return NextResponse.json({
      nonce: challenge.nonce,
      // The exact bytes to hand to `signMessage`. Returned rather than rebuilt
      // client-side, so the client cannot produce a different message than the
      // one stored — see the note in `wallet-auth.ts`.
      message: challenge.message,
      expiresAt: challenge.expiresAt.toISOString()
    });
  } catch (error) {
    if (error instanceof WalletChallengeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
