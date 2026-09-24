import Link from "next/link";
import type { Route } from "next";
import { WalletSignIn } from "@/components/WalletSignIn";
import { Reveal } from "@/components/fobs/motion";
import { currentUser } from "@/lib/server/session";
import { googleConfigured } from "@/lib/server/google-oauth";
import { xConfigured } from "@/lib/server/x-oauth";

export const dynamic = "force-dynamic";

const REASONS: Record<string, string> = {
  unconfigured: "X credentials are not set on this deployment.",
  google_unconfigured: "Google credentials are not set on this deployment.",
  denied: "You cancelled the consent screen.",
  invalid_request: "That sign-in link was incomplete or expired. Try again.",
  exchange_failed:
    "The provider rejected the sign-in. This is usually a wrong callback URL.",
  link_requires_session:
    "Sign in first, then link the account from your account page."
};

/**
 * Sign in — the login half of the auth pair (its sibling is /welcome, sign up).
 *
 * Split layout: an editorial brand panel on the left, the auth card on the
 * right. Every provider is shown always, whether or not it is configured — an
 * unavailable one says what would enable it, because an absent button teaches
 * the visitor that FOBS has no wallet support when the truth is a missing env
 * var. Wallet sign-in is first and never gated: it is a signature check against
 * a public key. None of the auth mechanisms changed — only the frame did.
 */
export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const viewer = await currentUser();

  return (
    <main className="min-h-screen bg-[#f4f3ef] text-[#111312] lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Left — editorial brand panel. Decorative, hidden on small screens. */}
      <aside className="relative hidden overflow-hidden bg-[#e7e1f3] px-12 py-14 lg:flex lg:flex-col lg:justify-between">
        <div
          className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[#f5ddd2] blur-3xl"
          aria-hidden="true"
        />
        <div
          className="absolute bottom-[-60px] left-[-40px] h-56 w-56 rounded-full bg-[#dceafa] blur-3xl"
          aria-hidden="true"
        />

        <Link
          href={"/" as Route}
          className="relative text-lg font-semibold tracking-[-0.04em]"
        >
          fobs
        </Link>

        <div className="relative">
          <h1 className="text-[52px] font-semibold leading-[0.95] tracking-[-0.055em]">
            Trade what
            <br />
            your friends
            <br />
            trade.
          </h1>
          <p className="mt-6 max-w-sm text-sm leading-6 text-[#4c4d47]">
            The feed, markets and profiles are open to read. An account is what a
            wallet attaches to — and what lets you trade real swaps you sign
            yourself.
          </p>
        </div>

        <p className="relative text-xs leading-5 text-[#6e6f69]">
          Real swaps on Solana mainnet, signed by your own wallet. FOBS issues
          nothing, holds no key, and takes no custody.
        </p>
      </aside>

      {/* Right — the auth column. */}
      <div className="flex min-h-screen flex-col justify-center px-6 py-12 sm:px-10">
        <Reveal className="mx-auto w-full max-w-[440px]">
          <Link
            href={"/" as Route}
            className="text-base font-semibold tracking-[-0.04em] lg:hidden"
          >
            fobs
          </Link>

          <header className="mt-6 lg:mt-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#3175c6]">
              Welcome back
            </p>
            <h2 className="mt-3 text-[34px] font-semibold leading-none tracking-[-0.05em]">
              Sign in
            </h2>
          </header>

          {reason && REASONS[reason] ? (
            <div className="mt-6 rounded-[14px] border border-[#f5dcdc] bg-[#f9eded] px-4 py-3 text-sm text-[#a33f3f]">
              {REASONS[reason]}
            </div>
          ) : null}

          {viewer ? (
            <section className="mt-6 fobs-surface p-6">
              <h3 className="text-sm font-semibold">
                Already signed in as @{viewer.username}
              </h3>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  className="fobs-button-primary"
                  href={(viewer.walletAddress ? "/feed" : "/welcome") as Route}
                >
                  {viewer.walletAddress ? "Open the feed" : "Finish setting up"}
                </Link>
                <Link className="fobs-button-secondary" href={"/account" as Route}>
                  Manage account
                </Link>
                <form action="/api/auth/sign-out" method="post">
                  <button className="fobs-button-secondary" type="submit">
                    Sign out
                  </button>
                </form>
              </div>
            </section>
          ) : (
            <div className="mt-6 space-y-4">
              <section className="fobs-surface p-6">
                <h3 className="mb-4 text-sm font-semibold">Sign in with a wallet</h3>
                <WalletSignIn />
              </section>

              <section className="fobs-surface p-6">
                <h3 className="text-sm font-semibold">Sign in with X</h3>
                {xConfigured() ? (
                  <>
                    <p className="mt-2 text-sm leading-6 text-[#777872]">
                      We read your public profile to create your FOBS account. We
                      never post on your behalf.
                    </p>
                    <Link
                      className="fobs-button-primary mt-4 inline-block"
                      href="/api/auth/x"
                    >
                      Continue with X
                    </Link>
                  </>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-[#777872]">
                    <code className="font-mono text-[#5c5d57]">X_CLIENT_ID</code> and{" "}
                    <code className="font-mono text-[#5c5d57]">X_CALLBACK_URL</code>{" "}
                    are not set, so this button has nothing to talk to. The OAuth
                    flow itself is implemented — those two variables are all it
                    takes. Note that{" "}
                    <code className="font-mono text-[#5c5d57]">X_CALLBACK_URL</code>{" "}
                    has to be publicly reachable: X&apos;s servers make that
                    redirect, not your browser.
                  </p>
                )}
              </section>

              <section className="fobs-surface p-6">
                <h3 className="text-sm font-semibold">Sign in with Google</h3>
                {googleConfigured() ? (
                  <>
                    <p className="mt-2 text-sm leading-6 text-[#777872]">
                      We read your name, email and avatar to create your FOBS
                      account. Nothing else, and no offline access.
                    </p>
                    <Link
                      className="fobs-button-primary mt-4 inline-block"
                      href="/api/auth/google"
                    >
                      Continue with Google
                    </Link>
                  </>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-[#777872]">
                    <code className="font-mono text-[#5c5d57]">GOOGLE_CLIENT_ID</code>,{" "}
                    <code className="font-mono text-[#5c5d57]">
                      GOOGLE_CLIENT_SECRET
                    </code>{" "}
                    and{" "}
                    <code className="font-mono text-[#5c5d57]">
                      GOOGLE_CALLBACK_URL
                    </code>{" "}
                    are not set, so this button has nothing to talk to. The flow is
                    implemented — create an OAuth client in Google Cloud, put those
                    three values in{" "}
                    <code className="font-mono text-[#5c5d57]">.env.local</code>, and
                    this becomes a working button.
                  </p>
                )}
              </section>

              <p className="text-sm text-[#777872]">
                New here?{" "}
                <Link href={"/welcome" as Route} className="text-[#3175c6]">
                  Create an account
                </Link>{" "}
                ·{" "}
                <Link href={"/feed" as Route} className="text-[#3175c6]">
                  Skip for now
                </Link>
              </p>
            </div>
          )}

          <footer className="mt-8 text-xs leading-5 text-[#9b9c95]">
            <Link href={"/terms" as Route} className="text-[#3175c6] underline">
              Terms and full disclosure
            </Link>{" "}
            — including how wallet keys are held.
          </footer>
        </Reveal>
      </div>
    </main>
  );
}
