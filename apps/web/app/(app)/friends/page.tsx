import type { Route } from "next";
import Link from "next/link";
import { FollowButton } from "@/components/FollowButton";
import { Reveal, Stagger, StaggerItem } from "@/components/fobs/motion";
import { listPeople } from "@/lib/server/queries";
import { currentUser } from "@/lib/server/session";
import { initials } from "@/lib/format";

export const dynamic = "force-dynamic";

type Person = Awaited<ReturnType<typeof listPeople>>[number];

/**
 * Following is a first-class thing, not a settings screen: it is what the
 * Following feed is made of and what decides who gets told when you trade. The
 * search is a plain GET form so the filter lives in the URL — shareable,
 * refresh-safe, works without JavaScript.
 */
export default async function FriendsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const searching = query !== "";
  const viewer = await currentUser();
  const people = await listPeople(viewer?.id ?? null, query);

  const following = people.filter((person) => person.viewerFollows);
  // Your own account is hidden from "everyone else" — except while searching, so
  // a search for your own name does not render two empty sections.
  const others = people.filter(
    (person) => !person.viewerFollows && (!person.isViewer || searching)
  );
  const nothingFound = searching && people.length === 0;

  return (
    <div className="space-y-5">
      <Reveal>
        <section>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#898a84]">
            Your people
          </span>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.05em]">Friends</h1>
          <p className="mt-1 text-sm text-[#777872]">
            People you follow shape your Following feed and get notified when you trade.
            Nobody is followed by default.
          </p>
        </section>
      </Reveal>

      <Reveal delay={0.05}>
        <form method="get" action="/friends" className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search by name or @username"
            aria-label="Search people"
            className="min-w-0 flex-1 rounded-lg border border-[#e3e2dc] bg-white px-4 py-2.5 text-sm outline-none placeholder:text-[#999a93] focus:border-[#c9c8c1]"
          />
          <button type="submit" className="fobs-button-primary">
            Search
          </button>
          {searching ? (
            <Link
              href={"/friends" as Route}
              className="fobs-button-secondary inline-flex items-center"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </Reveal>

      {nothingFound ? (
        <div className="fobs-surface p-6 text-center">
          <h3 className="text-sm font-semibold">No one matches &ldquo;{query}&rdquo;</h3>
          <p className="mt-1 text-xs text-[#777872]">
            Search covers usernames and display names, and only accounts that exist here —
            there is no lookup against X.
          </p>
          <p className="mt-3">
            <Link href={"/friends" as Route} className="text-xs font-medium text-[#3175c6]">
              Show everyone
            </Link>
          </p>
        </div>
      ) : null}

      <Reveal delay={0.1}>
        <PeopleSection
          title={`Following (${following.length})`}
          people={following}
          viewer={viewer !== null}
          empty={
            query === ""
              ? "You are not following anyone yet. Everyone below is a start."
              : "You do not follow anyone matching that."
          }
        />
      </Reveal>

      <Reveal delay={0.15}>
        <PeopleSection
          title={`Everyone else (${others.length})`}
          people={others}
          viewer={viewer !== null}
          empty={query === "" ? "Nobody else is here yet." : "Nobody else matches that."}
        />
      </Reveal>

      <Reveal delay={0.2} className="fobs-surface p-5 text-xs leading-relaxed text-[#777872]">
        <strong className="font-semibold text-[#111312]">How follows are used.</strong> A
        follow creates a row in this deployment&apos;s database. It is social state, so it
        lives off chain. When someone you follow trades, the swap is recorded and you get a
        notification.
      </Reveal>
    </div>
  );
}

function PeopleSection({
  title,
  people,
  viewer,
  empty
}: {
  title: string;
  people: Person[];
  viewer: boolean;
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {people.length === 0 ? (
        <div className="fobs-surface p-5 text-xs text-[#777872]">{empty}</div>
      ) : (
        <Stagger className="fobs-surface overflow-hidden">
          {people.map((person) => (
            <StaggerItem key={person.id} className="border-b border-[#efeee9] last:border-b-0">
              <PersonRow person={person} viewer={viewer} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </section>
  );
}

function PersonRow({ person, viewer }: { person: Person; viewer: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-4">
      <Link
        href={`/profile/${person.username}` as Route}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e9e5dc] text-[11px] font-semibold"
      >
        {initials(person.displayName)}
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          href={`/profile/${person.username}` as Route}
          className="block truncate text-sm font-medium"
        >
          {person.displayName}
        </Link>
        <div className="mt-0.5 text-xs text-[#898a84]">@{person.username}</div>
      </div>

      <div className="text-xs text-[#777872]">
        <span className="font-medium text-[#111312]">{person.tradeCount}</span>{" "}
        {person.tradeCount === 1 ? "trade" : "trades"} ·{" "}
        <span className="font-medium text-[#111312]">{person.followerCount}</span>{" "}
        {person.followerCount === 1 ? "follower" : "followers"}
      </div>

      <div className="flex items-center gap-3">
        {person.isViewer ? (
          <span className="rounded-md bg-[#f0efe9] px-2 py-1 text-[10px] font-medium text-[#777872]">
            That is you
          </span>
        ) : (
          <FollowButton
            username={person.username}
            following={person.viewerFollows}
            signedIn={viewer}
          />
        )}
        <Link
          href={`/profile/${person.username}?tab=holdings` as Route}
          className="text-xs font-medium text-[#3175c6]"
        >
          View portfolio →
        </Link>
      </div>
    </div>
  );
}
