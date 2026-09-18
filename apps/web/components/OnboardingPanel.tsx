"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The consent step, and the only thing on this page that does anything.
 *
 * Sign-in used to create a wallet silently inside the OAuth callback. That is a
 * server holding a signing key on someone's behalf, done without asking, and the
 * one piece of this product where "we told you" has to be true rather than
 * implied. So the button is the whole point: nothing is generated until it is
 * pressed, and the page states what will exist afterwards.
 */

type Outcome = {
  address: string;
  created: boolean;
  sol: number;
  usdc: number;
  problems: string[];
};

export function OnboardingPanel({ custodyReady }: { custodyReady: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Outcome | null>(null);

  if (done) {
    return (
      <div className="panel">
        <h3>{done.created ? "Wallet created" : "Wallet already existed"}</h3>
        <p className="muted">
          <span className="chip">
            {done.address.slice(0, 6)}…{done.address.slice(-6)}
          </span>
        </p>
        {done.sol > 0 || done.usdc > 0 ? (
          <p>
            Funded with{" "}
            {done.sol > 0 ? `${done.sol.toFixed(2)} devnet SOL` : null}
            {done.sol > 0 && done.usdc > 0 ? " and " : null}
            {done.usdc > 0 ? `$${done.usdc.toLocaleString()} test USDC` : null}.
          </p>
        ) : (
          <p className="muted">
            No funds were transferred — the balance was already sufficient, or no
            admin keypair is configured on this deployment.
          </p>
        )}
        {done.problems.length > 0 ? (
          <div className="disclosure">
            <strong>The wallet exists but funding did not complete.</strong>{" "}
            {done.problems.join(" ")} You can still try a trade — the first trade
            attempts the top-up again.
          </div>
        ) : null}
        <p style={{ marginTop: 12 }}>
          <button
            className="button"
            onClick={() => {
              router.push("/feed");
              router.refresh();
            }}
          >
            Go to the feed
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      {error ? <p className="danger">{error}</p> : null}
      <button
        className="button"
        disabled={busy || !custodyReady}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const response = await fetch("/api/onboarding", { method: "POST" });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? "Onboarding failed.");
            setDone(body as Outcome);
            router.refresh();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Onboarding failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Creating your wallet…" : "Create my devnet wallet"}
      </button>
      {!custodyReady ? (
        <p className="muted" style={{ marginTop: 10 }}>
          This deployment has no custody key set, so it cannot create a wallet.
        </p>
      ) : null}
    </div>
  );
}
