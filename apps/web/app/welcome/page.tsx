import Link from "next/link";
import { OnboardingPanel } from "@/components/OnboardingPanel";
import { custodyConfigured } from "@/lib/server/custody";
import { fundingConfigured } from "@/lib/server/funding";
import { currentUser } from "@/lib/server/session";
import { SOL_PER_USER, USDC_PER_USER } from "@/lib/server/funding";

export const dynamic = "force-dynamic";

/**
 * Onboarding: the step between identifying someone and letting them trade.
 *
 * This page exists so that creating a keypair can be *said out loud* before it
 * happens. The custody arrangement here — the server holds the key and signs
 * with it — is the most consequential thing about this build, and it was
 * previously a silent side effect of the sign-in callback. Making it a page with
 * a button costs one click and is the difference between disclosure and
 * concealment.
 *
 * The amounts are read from the funding constants rather than typed here, so the
 * page cannot promise a number the funding code does not deliver.
 */
export default async function WelcomePage() {
  const viewer = await currentUser();
  const usdc = Number(USDC_PER_USER) / 1e6;

  if (!viewer) {
    return (
      <div className="landing">
        <header className="hero">
          <div className="brand">
            <Link className="brand" href="/">
              <span className="mark">F</span>
              <span>
                <h1>FOBS</h1>
                <p>Get started</p>
              </span>
            </Link>
          </div>
          <Link className="secondary" href="/feed">
            Skip for now
          </Link>
        </header>
        <section className="landing-section">
          <h3>Sign in to create a wallet</h3>
          <p className="muted">
            You can read the feed without an account. Trading needs a wallet, and a
            wallet needs an account.
          </p>
          <Link className="button" href="/sign-in">
            Sign in
          </Link>
        </section>
      </div>
    );
  }

  if (viewer.walletAddress) {
    return (
      <div className="landing">
        <header className="hero">
          <div className="brand">
            <Link className="brand" href="/">
              <span className="mark">F</span>
              <span>
                <h1>FOBS</h1>
                <p>Get started</p>
              </span>
            </Link>
          </div>
          <Link className="secondary" href="/feed">
            Skip for now
          </Link>
        </header>
        <section className="landing-section">
          <h3>You already have a wallet</h3>
          <p className="muted">
            <span className="chip">
              {viewer.walletAddress.slice(0, 6)}…{viewer.walletAddress.slice(-6)}
            </span>
          </p>
          <div className="row">
            <Link className="button" href="/feed">
              Open the feed
            </Link>
            <Link className="secondary" href="/portfolio">
              See your portfolio
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="landing">
      <header className="hero">
        <div className="brand">
          <Link className="brand" href="/">
            <span className="mark">F</span>
            <span>
              <h1>FOBS</h1>
              <p>One step left</p>
            </span>
          </Link>
        </div>
        <Link className="secondary" href="/feed">
          Skip for now
        </Link>
      </header>

      <section className="landing-section">
        <h3>Create your trading wallet</h3>
        <p className="muted">
          Hello {viewer.displayName}. You are signed in as{" "}
          <strong>@{viewer.username}</strong>, but you have no wallet yet — which is
          what a trade is signed with.
        </p>
      </section>

      <section className="landing-section disclosure">
        <strong>Read this before you press the button.</strong>
        <ul>
          <li>
            <strong>We generate the key and keep it.</strong> A keypair is created on
            the server, encrypted, and stored in this app&apos;s database. Signing a
            trade uses it on your behalf. That means this server can sign as you — it
            is custody, not self-custody. Do not use a wallet here for anything that
            matters.
          </li>
          <li>
            <strong>It is devnet only.</strong> The wallet is created on Solana
            devnet. The {usdc.toLocaleString()} USDC it is funded with is a test token
            this program mints, and the {SOL_PER_USER} SOL is devnet SOL obtained
            free. Neither is worth anything.
          </li>
          <li>
            <strong>You can skip this.</strong> The feed, profiles and markets are
            readable without a wallet. Nothing breaks; you just cannot trade.
          </li>
        </ul>
      </section>

      <section className="landing-section">
        <OnboardingPanel custodyReady={custodyConfigured()} />
        {!fundingConfigured() ? (
          <p className="muted" style={{ marginTop: 10 }}>
            No admin keypair is configured on this deployment, so the wallet will be
            created but not funded. Run <code>pnpm devnet:users</code> from the repo
            root to top accounts up.
          </p>
        ) : null}
      </section>
    </div>
  );
}
