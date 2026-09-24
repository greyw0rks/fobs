import Link from "next/link";
import type { Route } from "next";
import { Reveal } from "@/components/fobs/motion";
import { LinkWalletPanel } from "@/components/LinkWalletPanel";
import { currentUser } from "@/lib/server/session";
import { walletsFor } from "@/lib/server/wallets";

export const dynamic = "force-dynamic";

/**
 * Onboarding / sign up — the sibling of /sign-in (login).
 *
 * FOBS holds no key and takes no custody, so there is nothing to *create* here —
 * a trade is a swap signed by a wallet the user already holds. This page says
 * that plainly and is where you connect one. Three branches: no viewer, signed
 * in with a wallet, signed in without one — and the last one is now a *required*
 * step: `app/(app)/layout.tsx` sends any signed-in account with no wallet here,
 * so the connect panel is embedded rather than pointing off to `/account`.
 */
export default async function WelcomePage() {
  const viewer = await currentUser();

  if (!viewer) {
    return (
      <Frame>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#3175c6]">
          Get started
        </p>
        <h2 className="mt-3 text-[34px] font-semibold leading-none tracking-[-0.05em]">
          Create your account
        </h2>
        <p className="mt-4 text-sm leading-6 text-[#6e6f69]">
          You can read the feed without an account. Trading needs a wallet you
          connect, and connecting one needs an account.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link className="fobs-button-primary" href={"/sign-in" as Route}>
            Sign in to continue
          </Link>
          <Link className="fobs-button-secondary" href={"/feed" as Route}>
            Read the feed first
          </Link>
        </div>

        <p className="mt-6 text-sm text-[#777872]">
          Already have an account?{" "}
          <Link href={"/sign-in" as Route} className="text-[#3175c6]">
            Sign in
          </Link>
        </p>
      </Frame>
    );
  }

  if (viewer.walletAddress) {
    return (
      <Frame>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#3175c6]">
          Get started
        </p>
        <h2 className="mt-3 text-[34px] font-semibold leading-none tracking-[-0.05em]">
          You&apos;re ready to trade
        </h2>
        <p className="mt-4 text-sm leading-6 text-[#6e6f69]">
          Your wallet is connected:{" "}
          <span className="rounded-md bg-[#eeeee9] px-2 py-0.5 font-mono text-xs text-[#111312]">
            {viewer.walletAddress.slice(0, 6)}…{viewer.walletAddress.slice(-6)}
          </span>
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link className="fobs-button-primary" href={"/feed" as Route}>
            Open the feed
          </Link>
          <Link className="fobs-button-secondary" href={"/portfolio" as Route}>
            See your portfolio
          </Link>
        </div>
      </Frame>
    );
  }

  const linkedWallets = await walletsFor(viewer.id);

  return (
    <Frame>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#3175c6]">
        One step left
      </p>
      <h2 className="mt-3 text-[34px] font-semibold leading-none tracking-[-0.05em]">
        Connect a wallet to continue
      </h2>
      <p className="mt-4 text-sm leading-6 text-[#6e6f69]">
        Hello {viewer.displayName}. You are signed in as{" "}
        <strong>@{viewer.username}</strong>, but you have no wallet yet — and on
        mainnet a trade is a swap your <em>own</em> wallet signs. Connect one to
        finish setting up your account.
      </p>

      <div className="mt-8 rounded-[18px] border border-[#e3e2dc] bg-white p-6">
        <h3 className="text-sm font-semibold">Connect your wallet</h3>
        <div className="mt-3">
          <LinkWalletPanel alreadyLinked={linkedWallets.map((wallet) => wallet.address)} />
        </div>
      </div>

      <div className="mt-6 rounded-[18px] border border-[#e3e2dc] bg-[#eeeee9] p-6">
        <h3 className="text-sm font-semibold">How trading works here</h3>
        <ul className="mt-4 list-none space-y-3 text-sm leading-6 text-[#5c5d57]">
          <li>
            <strong className="text-[#111312]">
              Connect a wallet you already hold.
            </strong>{" "}
            Phantom, Solflare or Backpack, on mainnet. You link it with a
            signature — nothing is stored, and this server never has a key for you.
          </li>
          <li>
            <strong className="text-[#111312]">
              Every trade is a swap you sign.
            </strong>{" "}
            FOBS builds the route and forwards it; your wallet signs it. FOBS issues
            nothing, holds nothing, and cannot move your funds.
          </li>
        </ul>
      </div>
    </Frame>
  );
}

/** Split brand-panel frame shared by all three onboarding branches. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f4f3ef] text-[#111312] lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#dfd2f2] px-12 py-14 lg:flex lg:flex-col lg:justify-between">
        <div
          className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-[#dceafa] blur-3xl"
          aria-hidden="true"
        />
        <div
          className="absolute bottom-[-60px] right-[-40px] h-56 w-56 rounded-full bg-[#f5ddd2] blur-3xl"
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
            Join
            <br />
            the room.
          </h1>
          <p className="mt-6 max-w-sm text-sm leading-6 text-[#4c4d47]">
            Follow real traders, see what they actually paid, and open your own
            trade at your own size. No custody, no copy-trading — just the room.
          </p>
        </div>

        <p className="relative text-xs leading-5 text-[#6e6f69]">
          Real swaps on Solana mainnet, signed by your own wallet. FOBS issues
          nothing, holds no key, and takes no custody.
        </p>
      </aside>

      <div className="flex min-h-screen flex-col justify-center px-6 py-12 sm:px-10">
        <Reveal className="mx-auto mt-4 w-full max-w-[480px] lg:mt-0">
          <Link
            href={"/" as Route}
            className="mb-6 inline-block text-base font-semibold tracking-[-0.04em] lg:hidden"
          >
            fobs
          </Link>
          {children}
        </Reveal>
      </div>
    </main>
  );
}
