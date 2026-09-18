import Link from "next/link";
import { FollowButton } from "@/components/FollowButton";
import { Avatar } from "@/components/TradeCard";
import { listPeople } from "@/lib/server/queries";
import { currentUserOrDevFallback } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Following is a first-class thing, not a settings screen.
 *
 * It is what the Following tab is made of, and it is what decides who gets told
 * when you trade — so the page says that plainly rather than just listing names.
 */
export default async function FriendsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const searching = query !== "";
  const viewer = await currentUserOrDevFallback();
  const people = await listPeople(viewer?.id ?? null, query);

  const following = people.filter((person) => person.viewerFollows);
  // Your own account is not "someone else" to follow, so it is hidden from this
  // list — except while searching. Excluding it there meant a search for your
  // own name matched exactly one person, hid them, and rendered two empty
  // sections with no explanation, which reads as a broken search rather than as
  // "that is you".
  const others = people.filter(
    (person) => !person.viewerFollows && (!person.isViewer || searching)
  );
  const nothingFound = searching && people.length === 0;

  return (
    <>
      <div className="topbar">
        <div>
          <h2>Friends</h2>
          <p>
            People you follow shape your Following feed and get notified when you
            trade. Nobody is followed by default.
          </p>
        </div>
      </div>

      {/* A plain GET form: the filter lives in the URL, so it is shareable,
          survives a refresh, and works without JavaScript. */}
      <form className="row" method="get" action="/friends" style={{ marginBottom: 18 }}>
        <input
          className="input search"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by name or @username"
          aria-label="Search people"
        />
        <button className="button" type="submit">
          Search
        </button>
        {query !== "" ? (
          <Link className="secondary" href="/friends">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="grid">
        <section className="feed">
          {nothingFound ? (
            <div className="card">
              <h3>No one matches “{query}”</h3>
              <p className="muted">
                Search covers usernames and display names, and only accounts that
                exist here — there is no lookup against X.{" "}
                <Link href="/friends">Show everyone</Link>.
              </p>
            </div>
          ) : null}

          <div className="card">
            <h3>Following ({following.length})</h3>
            {following.length === 0 ? (
              <p className="muted">
                {query === ""
                  ? "You are not following anyone yet."
                  : "You do not follow anyone matching that."}
              </p>
            ) : (
              <div className="asset-list">
                {following.map((person) => (
                  <div className="asset-row" key={person.id}>
                    <PersonRow person={person} />
                    <FollowButton
                      username={person.username}
                      following
                      signedIn={viewer !== null}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Everyone else ({others.length})</h3>
            {others.length === 0 ? (
              <p className="muted">
                {query === ""
                  ? "Nobody else is here yet."
                  : "Nobody else matches that."}
              </p>
            ) : (
              <div className="asset-list">
                {others.map((person) => (
                  <div className="asset-row" key={person.id}>
                    <PersonRow person={person} />
                    {person.isViewer ? (
                      <span className="chip">That is you</span>
                    ) : (
                      <FollowButton
                        username={person.username}
                        following={false}
                        signedIn={viewer !== null}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="stack">
          <div className="panel">
            <h3>How follows are used</h3>
            <p className="muted">
              A follow creates a Follow row in Postgres. It is social state, so it
              lives off chain. When someone you follow trades, the indexer sees the
              receipt and creates a FRIEND_TRADE notification for you.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function PersonRow({ person }: { person: Awaited<ReturnType<typeof listPeople>>[number] }) {
  return (
    <span className="user">
      <Avatar name={person.displayName} avatar={person.avatar} />
      <span>
        <strong>
          <Link href={`/profile/${person.username}`}>{person.displayName}</Link>
        </strong>
        <br />
        <span className="muted">
          @{person.username} · {person.tradeCount}{" "}
          {person.tradeCount === 1 ? "trade" : "trades"} · {person.followerCount}{" "}
          {person.followerCount === 1 ? "follower" : "followers"}
        </span>
      </span>
    </span>
  );
}
