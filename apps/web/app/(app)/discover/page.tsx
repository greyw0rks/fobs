import type { Route } from "next";
import Link from "next/link";
import { MarketsTable } from "@/components/fobs/markets-table";
import { FollowButton } from "@/components/FollowButton";
import { Reveal, Stagger, StaggerItem } from "@/components/fobs/motion";
import { listAssets, listPeople } from "@/lib/server/queries";
import { changesForSymbols } from "@/lib/server/price-history";
import { currentUser } from "@/lib/server/session";
import { initials } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Discover.
 *
 * Two questions a new account has: which instruments is anything happening in,
 * and who is worth following. Both answered from real state — assets by indexed
 * trade count, people by whether they have traded at all. Nothing here is
 * curated by hand.
 */
export default async function DiscoverPage() {
  const viewer = await currentUser();
  const [assets, people] = await Promise.all([
    listAssets(),
    listPeople(viewer?.id ?? null, "")
  ]);

  const trending = [...assets].sort((a, b) => b.tradeCount - a.tradeCount).slice(0, 6);
  const changes = await changesForSymbols(trending.map((a) => a.symbol));

  const traders = people
    .filter((person) => !person.isViewer && person.tradeCount > 0)
    .sort((a, b) => b.tradeCount - a.tradeCount)
    .slice(0, 6);
  const anyone = people.filter((person) => !person.isViewer).slice(0, 6);
  const suggestions = traders.length > 0 ? traders : anyone;

  return (
    <div className="space-y-5">
      <Reveal>
        <section>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#898a84]">
            Find your way in
          </span>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.05em]">Discover</h1>
          <p className="mt-1 text-sm text-[#777872]">
            Where the trading actually is, and who is doing it. Both lists are read from real
            trades on the platform.
          </p>
        </section>
      </Reveal>

      <Reveal delay={0.05}>
        <MarketsTable
          assets={trending}
          changes={changes}
          title="Trending"
          subtitle="Ranked by how many trades have been recorded, not by price movement"
        />
      </Reveal>

      <Reveal delay={0.1}>
        <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">People to follow</h2>
            <p className="mt-1 text-[11px] text-[#85867f]">
              Following is what the Following feed is made of, and what decides who gets
              told when you trade.
            </p>
          </div>
          <Link href={"/friends" as Route} className="text-xs font-medium text-[#3175c6]">
            Everyone →
          </Link>
        </div>

        {suggestions.length === 0 ? (
          <div className="fobs-surface p-6 text-center">
            <h3 className="text-sm font-semibold">Nobody here yet</h3>
            <p className="mt-1 text-xs text-[#777872]">
              Accounts appear here as people join and start trading. Invite
              someone, or make the first trade yourself.
            </p>
          </div>
        ) : (
          <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {suggestions.map((person) => (
              <StaggerItem key={person.id} className="fobs-surface flex flex-col gap-4 p-5">
                <Link
                  href={`/profile/${person.username}` as Route}
                  className="flex items-center gap-3"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e9e5dc] text-[11px] font-semibold">
                    {initials(person.displayName)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {person.displayName}
                    </span>
                    <span className="block text-[10px] text-[#898a84]">
                      @{person.username}
                    </span>
                  </span>
                </Link>

                <div className="text-[11px] text-[#777872]">
                  <span className="font-medium text-[#111312]">{person.tradeCount}</span>{" "}
                  {person.tradeCount === 1 ? "trade" : "trades"} ·{" "}
                  <span className="font-medium text-[#111312]">{person.followerCount}</span>{" "}
                  {person.followerCount === 1 ? "follower" : "followers"}
                </div>

                <FollowButton
                  username={person.username}
                  following={person.viewerFollows}
                  signedIn={viewer !== null}
                />
              </StaggerItem>
            ))}
          </Stagger>
        )}
        </section>
      </Reveal>

      <Reveal delay={0.15} className="fobs-surface p-5 text-xs leading-relaxed text-[#777872]">
        <strong className="font-semibold text-[#111312]">Real mainnet tokens.</strong> Every
        symbol here already trades on Solana mainnet — fobs issues none of them and signs
        nothing. A tokenized equity is not the share itself.
      </Reveal>
    </div>
  );
}
