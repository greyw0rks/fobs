"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { useStandardWalletAdapters } from "@solana/wallet-standard-wallet-adapter-react";
import { useMemo, type ReactNode } from "react";
import { browserRpcUrl } from "@/lib/solana/config";

/**
 * Wallet connection, mounted once at the root.
 *
 * **Wallet Standard, not a wallet list.** This passes no named adapters. Every
 * modern Solana wallet — Phantom, Solflare, Backpack, Glow — registers itself
 * with the browser through the Wallet Standard, and `useStandardWalletAdapters`
 * discovers them. The alternative, `@solana/wallet-adapter-wallets`, is one
 * package that pulls in ~450 transitive dependencies (WalletConnect, Torus,
 * Stellar, USB/HID for hardware wallets) to name wallets that would have
 * announced themselves anyway. This is four packages and it keeps working when
 * a wallet we have never heard of ships.
 *
 * **No `@solana/wallet-adapter-react-ui`.** That package brings its own modal
 * and its own styles. This app has a bespoke design system
 * (`docs/DESIGN.md`, `app/globals.css`) and a stock modal in the middle of it
 * would look like a different product. The connect button is
 * `components/ConnectWalletButton.tsx`, built from the existing tokens.
 *
 * **`autoConnect`** so a returning visitor who has already approved this site
 * does not have to approve it again on every page load. It reconnects only
 * wallets that were previously authorised for this origin; it cannot connect one
 * that was not.
 *
 * This provider does not sign anything on its own. Signing happens where a trade
 * is placed — see `components/TradeCard.tsx` — and the signed bytes go to the
 * server, not straight to the RPC.
 */
export function WalletProviders({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => browserRpcUrl(), []);
  const wallets = useStandardWalletAdapters([]);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
