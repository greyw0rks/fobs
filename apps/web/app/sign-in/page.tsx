import Link from "next/link";
import { DevSignIn } from "@/components/DevSignIn";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/server/session";
import { devSignInAllowed, xConfigured } from "@/lib/server/x-oauth";

export const dynamic = "force-dynamic";

const REASONS: Record<string, string> = {
  unconfigured: "X credentials are not set on this deployment.",
  denied: "You cancelled the X consent screen.",
  invalid_request: "That sign-in link was incomplete or expired. Try again.",
  exchange_failed: "X rejected the sign-in. This is usually a wrong callback URL."
};

/**
 * Sign in.
 *
 * Two paths, and which one you get is stated rather than hidden. When X is
 * configured it is the real flow; when it is not, the page says so and offers
 * the seeded test accounts instead. The old demo route silently returned a fake
 * identity, which made "auth is not configured" indistinguishable from "auth
 * worked" — the worst possible failure for the one feature where that matters.
 */
export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const [viewer, testUsers] = await Promise.all([
    currentUser(),
    devSignInAllowed()
      ? prisma.user.findMany({
          where: { isTestUser: true },
          orderBy: { username: "asc" },
          select: {
            username: true,
            displayName: true,
            walletAddress: true,
            _count: { select: { trades: true } }
          }
        })
      : Promise.resolve([])
  ]);

  return (
    <div className="landing">
      <header className="hero">
        <div className="brand">
          <Link className="brand" href="/">
            <span className="mark">F</span>
            <span>
              <h1>FOBS</h1>
              <p>Sign in</p>
            </span>
          </Link>
        </div>
        <Link className="secondary" href="/feed">
          Skip for now
        </Link>
      </header>

      {reason && REASONS[reason] ? (
        <div className="panel disclosure">{REASONS[reason]}</div>
      ) : null}

      {viewer ? (
        <section className="landing-section">
          <h3>Already signed in as @{viewer.username}</h3>
          <div className="row">
            <Link className="button" href={viewer.walletAddress ? "/feed" : "/welcome"}>
              {viewer.walletAddress ? "Open the feed" : "Finish setting up"}
            </Link>
            <form action="/api/auth/sign-out" method="post">
              <button className="secondary" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </section>
      ) : (
        <section className="landing-section">
          <h3>Sign in with X</h3>
          {xConfigured() ? (
            <>
              <p className="muted">
                We read your public profile to create your FOBS account. We never post
                on your behalf.
              </p>
              <Link className="button" href="/api/auth/x">
                Continue with X
              </Link>
            </>
          ) : (
            <>
              <p className="muted">
                <code>X_CLIENT_ID</code> and <code>X_CALLBACK_URL</code> are not set,
                so the real flow is unavailable. On a deployed instance those two
                variables are all it takes — the OAuth flow itself is implemented.
              </p>
              <p className="muted">
                For the test environment, sign in as one of the seeded accounts. Each
                holds a real devnet keypair and a real USDC balance, and trades they
                make settle on devnet.
              </p>
            </>
          )}
        </section>
      )}

      {!viewer && testUsers.length > 0 ? (
        <section className="landing-section">
          <h3>Seeded test accounts</h3>
          <p className="muted">
            Available because this is not a production deployment. Each of these
            signs real devnet transactions from the server.
          </p>
          <DevSignIn
            users={testUsers.map((user) => ({
              username: user.username,
              displayName: user.displayName,
              walletAddress: user.walletAddress,
              tradeCount: user._count.trades
            }))}
          />
        </section>
      ) : null}

      <section className="landing-section disclosure">
        Every account here signs real transactions on Solana devnet. Nothing is
        simulated, and nothing is worth anything.
      </section>

      <footer className="landing-section muted">
        <Link href="/terms">Terms and full disclosure</Link> — including how wallet
        keys are held.
      </footer>
    </div>
  );
}
