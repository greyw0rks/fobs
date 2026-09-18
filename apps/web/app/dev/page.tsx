import Link from "next/link";
import { notFound } from "next/navigation";
import { DevHarness } from "@/components/DevHarness";
import { devSignInAllowed } from "@/lib/server/x-oauth";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * The dev harness page.
 *
 * `notFound()` rather than a "disabled" message: on a real deployment this route
 * should not be distinguishable from one that was never built, and a page that
 * says "the dev harness is off" is itself a disclosure.
 */
export default async function DevPage() {
  if (!devSignInAllowed()) notFound();

  // The API requires a session, so the page does too. Rendering a harness whose
  // every button returns 401 would be a worse explanation than saying why.
  const viewer = await currentUser();
  if (!viewer) {
    return (
      <>
        <header className="hero">
          <div className="brand">
            <Link className="brand" href="/feed">
              <span className="mark">F</span>
              <span>
                <h1>Dev harness</h1>
                <p>Sign in to use it</p>
              </span>
            </Link>
          </div>
          <Link className="secondary" href="/feed">
            Back to the feed
          </Link>
        </header>

        <section className="landing-section">
          <h3>This page needs a session</h3>
          <p className="muted">
            The harness triggers indexing passes and signs real devnet transactions
            as the seeded accounts. That is not something an anonymous request should
            be able to do, so it is behind a sign-in. On a production deployment the
            whole page and its API do not exist.
          </p>
          <Link className="button" href="/sign-in">
            Sign in
          </Link>
        </section>
      </>
    );
  }

  return (
    <>
      <header className="hero">
        <div className="brand">
          <Link className="brand" href="/feed">
            <span className="mark">F</span>
            <span>
              <h1>Dev harness</h1>
              <p>Real devnet state, not a mock</p>
            </span>
          </Link>
        </div>
        <Link className="secondary" href="/feed">
          Back to the feed
        </Link>
      </header>

      <DevHarness />
    </>
  );
}
