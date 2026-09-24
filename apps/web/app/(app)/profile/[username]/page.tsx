import type { Route } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { FollowButton } from "@/components/FollowButton";
import { ShareActions } from "@/components/ShareActions";
import { ProfileLinksForm } from "@/components/ProfileLinksForm";
import { ActivityCard } from "@/components/fobs/activity-card";
import { PortfolioChart } from "@/components/fobs/portfolio-chart";
import { Reveal, Stagger, StaggerItem } from "@/components/fobs/motion";
import { getPortfolio, getProfile } from "@/lib/server/queries";
import { currentUser } from "@/lib/server/session";
import { ago, initials, money, qty } from "@/lib/format";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "activity", label: "Activity" },
  { id: "holdings", label: "Holdings" },
  { id: "about", label: "About" }
] as const;

type Tab = (typeof TABS)[number]["id"];

/**
 * A profile.
 *
 * The identity is the page, so it gets a banner header with the avatar, name,
 * and counts. A segmented control (in the URL as `?tab=`) switches the body
 * between the person's activity, their open holdings, and account details —
 * every figure read straight from the same request that draws the page.
 *
 * The portfolio card is fed `series={[]}` on purpose: there is no real value
 * time-series to chart yet, so it shows the current total and its graceful
 * "not enough history" state rather than inventing a line or a return %.
 */
export default async function ProfilePage({
  params,
  searchParams
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { username } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : "activity";

  const viewer = await currentUser();
  const profile = await getProfile(username, viewer?.id ?? null);
  if (!profile) notFound();

  const portfolio = await getPortfolio(profile.user.id);
  const holdings = portfolio.holdings;

  return (
    <div className="mx-auto max-w-[900px] space-y-5">
      <Reveal>
        <section className="fobs-surface overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-[#dceafa] via-[#e9ddf5] to-[#f5ddd2]" />

        <div className="px-6 pb-6">
          <div className="-mt-10 flex items-end justify-between gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-[#ded8cd] text-lg font-semibold">
              {initials(profile.user.displayName)}
            </div>

            <div className="flex items-center gap-2">
              <ShareActions />
              {!profile.isViewer ? (
                <FollowButton
                  username={profile.user.username}
                  following={profile.viewerFollows}
                  signedIn={viewer !== null}
                />
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.03em]">
              {profile.user.displayName}
            </h1>
            {profile.isViewer ? (
              <span className="rounded-md bg-[#f0efe9] px-2 py-0.5 text-[10px] font-medium text-[#777872]">
                This is you
              </span>
            ) : null}
          </div>

          <p className="text-xs text-[#777872]">@{profile.user.username}</p>

          {profile.user.bio ? (
            <p className="mt-3 max-w-[560px] text-sm leading-6 text-[#4c4d47]">
              {profile.user.bio}
            </p>
          ) : null}

          {profile.user.links.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {profile.user.links.map((lnk) => (
                <a
                  key={lnk.url}
                  href={lnk.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  className="rounded-full border border-[#e3e2dc] bg-white px-3 py-1 text-xs font-medium text-[#3175c6] transition-colors hover:border-[#c7c6bf]"
                >
                  {lnk.label}
                </a>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-5 text-xs">
            <span>
              <strong className="font-semibold">{profile.following}</strong> Following
            </span>
            <span>
              <strong className="font-semibold">{profile.followers}</strong>{" "}
              {profile.followers === 1 ? "Follower" : "Followers"}
            </span>
            <span>
              <strong className="font-semibold">{profile.trades.length}</strong>{" "}
              {profile.trades.length === 1 ? "Trade" : "Trades"}
            </span>
          </div>
        </div>
      </section>
      </Reveal>

      <Reveal delay={0.05}>
        <div>
          <PortfolioChart
            series={[]}
            totalValue={portfolio.totalValue}
            title="Portfolio value"
          />
          {portfolio.totalValue !== null && portfolio.unrealizedPnl !== null ? (
            <p className="mt-2 px-1 text-xs text-[#777872]">
              Unrealized P&amp;L{" "}
              <span
                className={
                  portfolio.unrealizedPnl >= 0 ? "font-semibold text-[#23845b]" : "font-semibold text-[#c94c4c]"
                }
              >
                {portfolio.unrealizedPnl >= 0 ? "+" : ""}
                {money(portfolio.unrealizedPnl)}
                {portfolio.unrealizedPct !== null
                  ? ` (${portfolio.unrealizedPct.toFixed(2)}%)`
                  : ""}
              </span>{" "}
              against cost basis — not a time-window return.
            </p>
          ) : null}
        </div>
      </Reveal>
      <Reveal delay={0.1}>
        <nav className="flex gap-1 border-b border-[#e5e3dd]">
          {TABS.map((item) => (
            <Link
              key={item.id}
              href={`/profile/${profile.user.username}?tab=${item.id}` as Route}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium ${
                tab === item.id
                  ? "border-[#111312] text-[#111312]"
                  : "border-transparent text-[#85867f]"
              }`}
            >
              {item.label}
              {item.id === "holdings" && holdings.length > 0 ? (
                <span className="ml-1 text-[#92938c]">{holdings.length}</span>
              ) : null}
            </Link>
          ))}
        </nav>
      </Reveal>

      {tab === "activity" ? (
        profile.trades.length === 0 ? (
          <Reveal delay={0.15} className="fobs-surface p-6 text-center">
            <h3 className="text-sm font-semibold">No trades yet</h3>
            <p className="mt-1 text-xs text-[#777872]">
              Trades appear here once their swap confirms on chain.
            </p>
            {profile.isViewer ? (
              <p className="mt-4">
                <Link href={"/stocks" as Route} className="fobs-button-primary inline-flex">
                  Browse markets
                </Link>
              </p>
            ) : null}
          </Reveal>
        ) : (
          <Stagger className="grid gap-4 sm:grid-cols-2">
            {profile.trades.map((trade) => (
              <StaggerItem key={trade.id}>
                <ActivityCard trade={trade} />
              </StaggerItem>
            ))}
          </Stagger>
        )
      ) : null}

      {tab === "holdings" ? (
        holdings.length === 0 ? (
          <Reveal delay={0.15} className="fobs-surface p-6 text-center">
            <h3 className="text-sm font-semibold">No open holdings</h3>
            <p className="mt-1 text-xs text-[#777872]">
              Positions show here while they are open. A fully-exited holding leaves the
              chain account behind but is not a position.
            </p>
          </Reveal>
        ) : (
          <div className="fobs-surface overflow-hidden">
            <div className="hidden grid-cols-4 border-b border-[#e5e3dd] px-5 py-3 text-[10px] uppercase tracking-wide text-[#8b8c85] sm:grid">
              <span>Asset</span>
              <span className="text-right">Quantity</span>
              <span className="text-right">Value</span>
              <span className="text-right">P&amp;L</span>
            </div>
            <Stagger>
              {holdings.map((holding) => (
                <StaggerItem key={holding.asset.id} className="border-b border-[#efeee9] last:border-b-0">
                  <Link
                    href={`/asset/${holding.asset.symbol}` as Route}
                    className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4 sm:items-center"
                  >
                    <div>
                      <div className="text-xs font-semibold">{holding.asset.symbol}</div>
                      <div className="text-[10px] text-[#92938c]">{holding.asset.name}</div>
                    </div>
                    <span className="text-xs sm:text-right">{qty(holding.quantity)}</span>
                    <span className="text-xs sm:text-right">
                      {holding.value === null ? "—" : money(holding.value)}
                    </span>
                    <span className="text-xs sm:text-right">
                      {holding.unrealizedPnl === null ? (
                        "—"
                      ) : (
                        <span
                          className={
                            holding.unrealizedPnl >= 0
                              ? "font-semibold text-[#23845b]"
                              : "font-semibold text-[#c94c4c]"
                          }
                        >
                          {holding.unrealizedPnl >= 0 ? "+" : ""}
                          {money(holding.unrealizedPnl)}
                        </span>
                      )}
                    </span>
                  </Link>
                </StaggerItem>
              ))}
            </Stagger>
            {portfolio.unpricedCount > 0 ? (
              <p className="px-5 py-3 text-[11px] text-[#85867f]">
                {portfolio.unpricedCount} holding
                {portfolio.unpricedCount === 1 ? "" : "s"} not shown — price not read, so no
                value or P&amp;L is invented for it.
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {tab === "about" ? (
        <Reveal delay={0.15}>
        <div className="space-y-5">
          <div className="fobs-surface p-5">
            <h2 className="text-sm font-semibold">Wallet</h2>
            {profile.user.walletAddress ? (
              <p className="mt-2">
                <span className="rounded-md bg-[#f0efe9] px-2 py-1 font-mono text-[11px]">
                  {profile.user.walletAddress.slice(0, 6)}…
                  {profile.user.walletAddress.slice(-6)}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-xs text-[#777872]">No wallet connected.</p>
            )}
            <p className="mt-2 text-xs text-[#777872]">
              Trades are attributed by the wallet that signed the swap, so this address is
              the link between the account and the chain.
            </p>
          </div>

          <div className="fobs-surface p-5">
            <h2 className="text-sm font-semibold">Connected accounts</h2>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[#777872]">Wallet</dt>
                <dd>
                  <ConnBadge connected={profile.user.walletAddress !== null} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[#777872]">X</dt>
                <dd>
                  <ConnBadge connected={profile.user.hasX} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[#777872]">Google</dt>
                <dd>
                  <ConnBadge connected={profile.user.hasGoogle} />
                </dd>
              </div>
            </dl>
            {profile.isViewer ? (
              <p className="mt-3 text-xs text-[#777872]">
                Manage these from{" "}
                <Link href={"/account" as Route} className="font-medium text-[#3175c6]">
                  your account
                </Link>
                .
              </p>
            ) : null}
          </div>

          {profile.isViewer ? (
            <ProfileLinksForm
              initialBio={profile.user.bio}
              initialLinks={profile.user.links}
            />
          ) : null}

          <div className="fobs-surface p-5">
            <h2 className="text-sm font-semibold">Account</h2>
            <dl className="mt-2 space-y-1 text-xs text-[#777872]">
              <div className="flex justify-between">
                <dt>Joined</dt>
                <dd>{ago(profile.user.createdAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Following</dt>
                <dd className="font-medium text-[#111312]">{profile.following}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Followers</dt>
                <dd className="font-medium text-[#111312]">{profile.followers}</dd>
              </div>
            </dl>
          </div>

          <div className="fobs-surface p-5 text-xs leading-relaxed text-[#777872]">
            Everything on this page came from this deployment&apos;s database, filled from
            real trades settled on mainnet. Token balances live in each wallet, not here.
          </div>
        </div>
        </Reveal>
      ) : null}
    </div>
  );
}

/** A small connected / not-connected chip, used in the "Connected accounts" list. */
function ConnBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="rounded-md bg-[#e7f1ea] px-2 py-1 text-[10px] font-medium text-[#23845b]">
      Connected
    </span>
  ) : (
    <span className="rounded-md bg-[#f0efe9] px-2 py-1 text-[10px] font-medium text-[#898a84]">
      Not connected
    </span>
  );
}
