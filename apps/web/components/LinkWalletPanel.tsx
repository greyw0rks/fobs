"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

/**
 * Link a browser wallet to the account that is already signed in.
 *
 * The mirror of `WalletSignIn`, with one difference that matters: the challenge
 * is issued with `purpose: "link"`, so it can only be redeemed against the
 * account that asked for it. The user id is taken from the session cookie by the
 * route, never sent from here — a client that could name the account to attach to
 * could attach its wallet to somebody else's.
 *
 * Linking an external wallet makes it the account's primary wallet. That is
 * deliberate and stated in the UI rather than discovered later: a wallet you
 * control should be the one you trade from, and the alternative — quietly
 * keeping the server-held key in front — is the thing this whole path exists to
 * move away from.
 */
export function LinkWalletPanel({ alreadyLinked }: { alreadyLinked: string[] }) {
  const adapter = useWallet();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  const address = adapter.publicKey?.toBase58() ?? null;
  const isAlready = address !== null && alreadyLinked.includes(address);

  async function link() {
    if (!adapter.publicKey || !adapter.signMessage || !address) return;
    setBusy(true);
    setError(null);
    try {
      const challenge = await api.walletNonce(address, "link");
      const signature = await adapter.signMessage(
        new TextEncoder().encode(challenge.message)
      );
      let binary = "";
      for (let i = 0; i < signature.length; i++) binary += String.fromCharCode(signature[i]);

      const result = await api.walletVerify({
        nonce: challenge.nonce,
        address,
        signature: btoa(binary),
        label: adapter.wallet?.adapter.name ?? null
      });

      setLinked(result.address ?? address);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Linking failed");
    } finally {
      setBusy(false);
    }
  }

  if (linked) {
    return (
      <p className="text-sm text-[#777872]">
        Linked{" "}
        <span className="font-mono text-[#111312]">
          {linked.slice(0, 4)}…{linked.slice(-4)}
        </span>{" "}
        and made it this account&apos;s primary wallet. Trades will now be signed
        in your wallet.
      </p>
    );
  }

  if (!adapter.connected || !address) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[#777872]">
          Connect the wallet you want to trade from. Once linked it becomes this
          account&apos;s primary wallet, and every order is signed in the browser
          — the server holds no key for it and never will.
        </p>
        <ConnectWalletButton />
      </div>
    );
  }

  if (isAlready) {
    return (
      <p className="text-sm text-[#777872]">
        <span className="font-mono text-[#111312]">
          {address.slice(0, 4)}…{address.slice(-4)}
        </span>{" "}
        is already linked to this account.
      </p>
    );
  }

  if (!adapter.signMessage) {
    return (
      <p className="text-sm text-[#777872]">
        {adapter.wallet?.adapter.name ?? "That wallet"} cannot sign a message,
        which is what proves the wallet is yours.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[#777872]">
        Sign a message to prove you control{" "}
        <span className="font-mono text-[#111312]">
          {address.slice(0, 4)}…{address.slice(-4)}
        </span>
        . This authorises no transaction.
      </p>
      <div className="flex items-center gap-2">
        <button className="fobs-button-primary" disabled={busy} onClick={() => void link()}>
          {busy ? "Waiting for your wallet…" : "Link this wallet"}
        </button>
        <button className="fobs-button-secondary" onClick={() => void adapter.disconnect()}>
          Use a different wallet
        </button>
      </div>
      {error ? <p className="text-sm text-[#c94c4c]">{error}</p> : null}
    </div>
  );
}
