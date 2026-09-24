import { NextResponse } from "next/server";
import { listFeed, type FeedView } from "@/lib/server/queries";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** The page size the feed view asks for. Stated here so the client and the
 *  "is there more?" answer cannot disagree about it. */
const PAGE = 50;

/**
 * One page of the feed.
 *
 * `before` is the cursor from the previous page — the `tradedAt` of its last
 * trade — and `nextCursor` is the one to send back. The client is told
 * `hasMore` rather than being left to infer it from a short page: a page that
 * happens to be exactly `limit` long is not proof of another page, and a client
 * that guesses wrong either shows a dead "Load more" or hides a live one.
 *
 * A malformed `before` is a 400 rather than a silently ignored parameter.
 * Ignoring it would return the first page again, which arrives at the client
 * looking exactly like a successful "load more" that appended duplicates.
 */
export async function GET(request: Request) {
  const viewer = await currentUser();
  const params = new URL(request.url).searchParams;

  const requested = params.get("view");
  const view: FeedView = requested === "for-you" ? "for-you" : "following";

  const raw = params.get("before");
  let before: Date | null = null;
  if (raw) {
    before = new Date(raw);
    if (Number.isNaN(before.getTime())) {
      return NextResponse.json(
        { error: `Not a valid cursor: ${raw}` },
        { status: 400 }
      );
    }
  }

  // One extra row, discarded. It is the only way to answer "is there another
  // page?" without a second count query, and it costs one row rather than one
  // round trip.
  const trades = await listFeed({ view, viewerId: viewer?.id ?? null, limit: PAGE + 1, before });
  const hasMore = trades.length > PAGE;
  const page = hasMore ? trades.slice(0, PAGE) : trades;

  return NextResponse.json({
    view,
    trades: page,
    hasMore,
    nextCursor: hasMore ? page[page.length - 1].tradedAt : null
  });
}
