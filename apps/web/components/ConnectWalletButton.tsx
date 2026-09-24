"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";

/**
 * Connect a Solana wallet, in this app's own clothes.
 *
 * `@solana/wallet-adapter-react-ui` ships a modal that would do this in one
 * import, and it is deliberately not used: this app has its own design system
 * (`docs/DESIGN.md`, `app/globals.css`) and a stock modal in the middle of it
 * would read as a different product bolted on. This is the same interaction
 * built from `.button`, `.card` and `.chip`.
 *
 * The wallet list comes from the Wallet Standard registry, so it includes
 * whatever the visitor actually has installed — and an empty list is a real
 * answer, not a failure. It means no Solana wallet is present in this browser,
 * and the honest thing to do is say so and link to one rather than show an empty
 * box.
 */
export function ConnectWalletButton({
  className,
  label = "Connect wallet"
}: {
  className?: string;
  label?: string;
}) {
  const { wallets, select, connecting, connected, publicKey, disconnect, wallet } = useWallet();
  const [open, setOpen] = useState(false);

  if (connected && publicKey) {
    const address = publicKey.toBase58();
    return (
      <div className="row">
        <span className="chip mono">
          {wallet?.adapter.name ?? "Wallet"} · {address.slice(0, 4)}…{address.slice(-4)}
        </span>
        <button className="secondary" onClick={() => void disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <button
        className={className ?? "button"}
        disabled={connecting}
        onClick={() => setOpen((value) => !value)}
      >
        {connecting ? "Connecting…" : label}
      </button>

      {open ? (
        <div className="card">
          {wallets.length === 0 ? (
            <p className="muted">
              No Solana wallet detected in this browser. Install{" "}
              <a href="https://phantom.app" target="_blank" rel="noreferrer">
                Phantom
              </a>{" "}
              or{" "}
              <a href="https://solflare.com" target="_blank" rel="noreferrer">
                Solflare
              </a>
              , then reload this page.
            </p>
          ) : (
            <div className="stack">
              {wallets.map((candidate) => (
                <button
                  key={candidate.adapter.name}
                  className="secondary"
                  onClick={() => {
                    select(candidate.adapter.name);
                    setOpen(false);
                  }}
                >
                  {candidate.adapter.name}
                  {candidate.readyState === "Installed" ? "" : " (not installed)"}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
