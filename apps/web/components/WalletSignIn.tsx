"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

/**
 * Sign in by proving you hold a wallet's key.
 *
 * Three steps, and the middle one is the whole point: the server issues a
 * message, the wallet signs it, and the server verifies the signature against
 * the address. No password, no email, and no key ever leaves the browser — the
 * server holds no key for this account, so every trade it makes is signed in the
 * browser too.
 *
 * The message is signed exactly as the server sent it. It is not rebuilt here,
 * not trimmed, not re-wrapped — the bytes that were stored are the bytes that
 * must be signed, and reproducing them by hand is how a working wallet starts
 * reporting "invalid signature".
 */
export function WalletSignIn() {
  const adapter = useWallet();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = adapter.publicKey?.toBase58() ?? null;

  async function signIn() {
    if (!adapter.publicKey || !adapter.signMessage) return;
    setBusy(true);
    setError(null);
    try {
      const challenge = await api.walletNonce(address!, "sign-in");

      // `signMessage` returns raw bytes; the route takes base64.
      const signature = await adapter.signMessage(
        new TextEncoder().encode(challenge.message)
      );
      let binary = "";
      for (let i = 0; i < signature.length; i++) binary += String.fromCharCode(signature[i]);

      const result = await api.walletVerify({
        nonce: challenge.nonce,
        address: address!,
        signature: btoa(binary),
        // Best-effort label for the account page. Not authoritative — the wallet
        // knows its own name, and this is only what to call it in a list.
        label: adapter.wallet?.adapter.name ?? null
      });

      // The session cookie is set; a full navigation rather than a client-side
      // one so every server component re-reads it. The destination is narrowed
      // rather than cast — the route only ever answers with these two, and a
      // typed route list should not be silenced to accept whatever arrives.
      router.push(result.redirectTo === "/welcome" ? "/welcome" : "/feed");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wallet sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  if (!adapter.connected || !address) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[#777872]">
          Connect a Solana wallet — Phantom, Solflare, Backpack, anything that
          supports signing a message. Your key stays in the wallet; FOBS never
          sees it and can never sign for you.
        </p>
        <ConnectWalletButton label="Connect a wallet" />
        {error ? <p className="text-sm text-[#c94c4c]">{error}</p> : null}
      </div>
    );
  }

  if (!adapter.signMessage) {
    return (
      <p className="text-sm text-[#777872]">
        {adapter.wallet?.adapter.name ?? "That wallet"} does not support signing
        a message, which is what proves the wallet is yours. Try Phantom,
        Solflare or Backpack.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[#777872]">
        Signing a message proves you control{" "}
        <span className="font-mono text-[#111312]">
          {address.slice(0, 4)}…{address.slice(-4)}
        </span>
        . It authorises no transaction and costs nothing.
      </p>
      <div className="flex items-center gap-2">
        <button className="fobs-button-primary" disabled={busy} onClick={() => void signIn()}>
          {busy ? "Waiting for your wallet…" : "Sign in with this wallet"}
        </button>
        <button className="fobs-button-secondary" onClick={() => void adapter.disconnect()}>
          Use a different wallet
        </button>
      </div>
      {error ? <p className="text-sm text-[#c94c4c]">{error}</p> : null}
    </div>
  );
}
