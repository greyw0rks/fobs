import { notFound } from "next/navigation";
import Link from "next/link";
import { FeedCard, Avatar } from "@/components/TradeCard";
import { FollowButton } from "@/components/FollowButton";
import { getProfile } from "@/lib/server/queries";
import { currentUserOrDevFallback } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const viewer = await currentUserOrDevFallback();
  const profile = await getProfile(username, viewer?.id ?? null);
  if (!profile) notFound();

  return (
    <>
      <div className="topbar">
        <div className="user">
          <Avatar name={profile.user.displayName} avatar={profile.user.avatar} />
          <span>
            <h2>{profile.user.displayName}</h2>
            <p className="muted">
              @{profile.user.username} · {profile.followers}{" "}
              {profile.followers === 1 ? "follower" : "followers"} · {profile.following}{" "}
              following
            </p>
          </span>
        </div>
        {!profile.isViewer ? (
          <FollowButton
            username={profile.user.username}
            following={profile.viewerFollows}
            signedIn={viewer !== null}
          />
        ) : null}
      </div>

      <div className="grid">
        <section className="feed">
          <h3 className="muted" style={{ marginBottom: 12 }}>
            {profile.trades.length} {profile.trades.length === 1 ? "trade" : "trades"}
          </h3>
          {profile.trades.length === 0 ? (
            <div className="card">
              <h3>No trades yet</h3>
              <p className="muted">
                Trades appear here once the indexer has read their receipts off the
                chain.
              </p>
            </div>
          ) : (
            profile.trades.map((trade) => <FeedCard key={trade.id} trade={trade} />)
          )}
        </section>

        <aside className="stack">
          <div className="panel">
            <h3>Wallet</h3>
            {profile.user.walletAddress ? (
              <p>
                <span className="chip">
                  {profile.user.walletAddress.slice(0, 6)}…
                  {profile.user.walletAddress.slice(-6)}
                </span>
              </p>
            ) : (
              <p className="muted">No wallet connected.</p>
            )}
            <p className="muted">
              Trades are attributed by the wallet that signed the receipt, so this
              address is the link between the account and the chain.
            </p>
          </div>

          <div className="panel disclosure">
            Everything on this page came from Postgres, which the indexer filled by
            reading devnet. Balances live in the program&apos;s vault accounts, not
            here.
          </div>

          <p className="muted">
            <Link href="/friends">Find more people to follow</Link>
          </p>
        </aside>
      </div>
    </>
  );
}
