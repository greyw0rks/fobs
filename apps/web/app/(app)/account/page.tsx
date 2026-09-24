import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LinkWalletPanel } from "@/components/LinkWalletPanel";
import { UsernameForm } from "@/components/UsernameForm";
import { Reveal, Stagger, StaggerItem } from "@/components/fobs/motion";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/server/session";
import { walletsFor } from "@/lib/server/wallets";
import { googleConfigured } from "@/lib/server/google-oauth";
import { xConfigured } from "@/lib/server/x-oauth";
import { ago } from "@/lib/format";

export const dynamic = "force-dynamic";

/** What each `?link=` reason from a callback means to the person reading it. */
const LINK_RESULTS: Record<string, string> = {
  x_linked: "X is now linked to this account.",
  google_linked: "Google is now linked to this account.",
  x_already_linked_elsewhere:
    "That X account is already linked to a different FOBS account. Sign in as that one, or use a different X account.",
  google_already_linked_elsewhere:
    "That Google account is already linked to a different FOBS account. Sign in as that one, or use a different Google account.",
  x_slot_taken: "This account already has a different X account linked.",
  google_slot_taken: "This account already has a different Google account linked.",
  session_expired: "Your session expired during the link. Sign in and try again."
};

/**
 * The account surface: what is attached, and how to attach more. Linking lives
 * here rather than on the sign-in page, because linking is something you do
 * while signed in — the opposite of signing in.
 */
export default async function AccountPage({
  searchParams
}: {
  searchParams: Promise<{ link?: string }>;
}) {
  const viewer = await currentUser();
  if (!viewer) redirect("/sign-in");

  const { link } = await searchParams;

  const [wallets, identity] = await Promise.all([
    walletsFor(viewer.id),
    prisma.user.findUniqueOrThrow({
      where: { id: viewer.id },
      select: { xUserId: true, googleId: true, createdAt: true }
    })
  ]);

  return (
    <div className="mx-auto max-w-[1000px] space-y-5">
      <Reveal>
        <section>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#898a84]">
            Account
          </span>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.05em]">
            @{viewer.username}
          </h1>
          <p className="mt-1 text-sm text-[#777872]">
            {viewer.displayName} · joined {ago(identity.createdAt)}
          </p>
        </section>
      </Reveal>

      {link && LINK_RESULTS[link] ? (
        <Reveal delay={0.05} className="fobs-surface p-4 text-xs text-[#3175c6]">
          {LINK_RESULTS[link]}
        </Reveal>
      ) : null}

      <Reveal delay={0.1}>
        <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-5">
          <div className="fobs-surface p-5">
            <UsernameForm current={viewer.username} />
          </div>

          <div className="fobs-surface p-5">
            <h3 className="text-sm font-semibold">Wallets</h3>
            <p className="mt-1 text-xs text-[#777872]">
              Every address this account can trade from. Exactly one is primary — that is the
              address trades are built for and the one a swap is recorded under.
            </p>

            {wallets.length === 0 ? (
              <p className="mt-3 text-xs text-[#777872]">
                No wallet yet.{" "}
                <Link href={"/welcome" as Route} className="font-medium text-[#3175c6]">
                  Finish setting up
                </Link>{" "}
                to create one, or link one you already hold below.
              </p>
            ) : (
              <Stagger className="mt-4 space-y-2">
                {wallets.map((wallet) => (
                  <StaggerItem
                    key={wallet.address}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#efeee9] px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">
                        {wallet.address.slice(0, 8)}…{wallet.address.slice(-8)}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-[#898a84]">
                        {wallet.source === "custody"
                          ? "Held by this server — cannot trade; connect your own wallet"
                          : `You hold the key${wallet.label ? ` · ${wallet.label}` : ""}`}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-md bg-[#f0efe9] px-2 py-1 text-[10px] font-medium text-[#777872]">
                      {wallet.isPrimary ? "Primary" : "Linked"}
                    </span>
                  </StaggerItem>
                ))}
              </Stagger>
            )}

            {wallets.length === 0 ? (
              <p className="mt-3 text-xs text-[#777872]">
                This account signs in without a wallet, so the server holds no key for
                it at all — link one you already hold to trade.
              </p>
            ) : null}
          </div>

          <div className="fobs-surface p-5">
            <h3 className="text-sm font-semibold">Link a wallet</h3>
            <div className="mt-3">
              <LinkWalletPanel alreadyLinked={wallets.map((wallet) => wallet.address)} />
            </div>
          </div>
        </section>
        <section className="space-y-5">
          <div className="fobs-surface p-5">
            <h3 className="text-sm font-semibold">Identities</h3>
            <dl className="mt-3 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[#777872]">X</dt>
                <dd>
                  {identity.xUserId ? (
                    <span className="rounded-md bg-[#f0efe9] px-2 py-1 text-[10px] font-medium text-[#777872]">
                      Linked
                    </span>
                  ) : xConfigured() ? (
                    <Link href="/api/auth/x?link=1" className="font-medium text-[#3175c6]">
                      Link X
                    </Link>
                  ) : (
                    <span className="text-[#898a84]">
                      Not linked — and X is not configured on this deployment
                    </span>
                  )}
                </dd>
              </div>

              <div className="flex items-center justify-between gap-3">
                <dt className="text-[#777872]">Google</dt>
                <dd>
                  {identity.googleId ? (
                    <span className="rounded-md bg-[#f0efe9] px-2 py-1 text-[10px] font-medium text-[#777872]">
                      Linked
                    </span>
                  ) : googleConfigured() ? (
                    <Link href="/api/auth/google?link=1" className="font-medium text-[#3175c6]">
                      Link Google
                    </Link>
                  ) : (
                    <span className="text-[#898a84]">
                      Not linked — and Google is not configured on this deployment
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-[#777872]">
              Linking attaches an identity to <em>this</em> account rather than switching to
              it, so your trades, follows and wallet stay where they are.
            </p>
          </div>

          <form action="/api/auth/sign-out" method="post">
            <button type="submit" className="fobs-button-secondary">
              Sign out
            </button>
          </form>
        </section>
      </div>
      </Reveal>
    </div>
  );
}
