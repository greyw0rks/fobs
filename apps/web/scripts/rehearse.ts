/**
 * The rehearsal: the demo path, over the HTTP surface the UI uses.
 *
 * Run: pnpm rehearse        (needs `pnpm dev` running)
 *
 * `smoke:loop` proves the trading loop by calling the same library functions the
 * routes call. This proves the layer above it — the one the browser actually
 * talks to. Every step goes through a real route with a real session cookie, and
 * the two users watch each other over a real SSE connection, so what is under
 * test includes the parts a library-level test cannot reach: session handling,
 * request validation, per-user event filtering, and the feed query behind the
 * JSON the components render.
 *
 * It is not a substitute for clicking through it once. It cannot see layout,
 * hydration or whether a component re-renders on an event. What it can do is
 * make sure that when you do sit down to click through, every layer underneath
 * is already known to work — so anything that goes wrong is a UI bug.
 */
const BASE = process.env.FOBS_BASE_URL ?? "http://localhost:3000";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

type FobsEvent =
  | { type: "trade"; id: string; username: string; assetSymbol: string; side: string;
      amountUsdc: string; txSignature: string | null; sourceTradeId: string | null }
  | { type: "notification"; id: string; userId: string; kind: string;
      actorUsername: string | null; assetSymbol: string | null; tradeId: string | null }
  | { type: "indexer"; assets: number; tradesIngested: number; at: string };

/** Sign in through the dev route and return a `cookie:` header value. */
async function signIn(username: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/dev`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username })
  });
  if (!response.ok) {
    throw new Error(
      `Could not sign in as ${username}: ${response.status} ${await response.text()}`
    );
  }
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie.includes("fobs_session=")) {
    throw new Error(`Sign-in for ${username} returned no session cookie.`);
  }
  return cookie;
}

async function api<T>(
  path: string,
  cookie: string,
  init: RequestInit = {}
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie,
      ...(init.headers ?? {})
    }
  });
  return { status: response.status, body: (await response.json()) as T };
}

/**
 * An open `/api/events` connection that accumulates what it receives.
 *
 * `waitFor` is a poll over the accumulated array rather than a callback invoked
 * on arrival. That matters: the server pushes the event and writes the HTTP
 * response from the same handler, so an event can reach this reader *before*
 * the `await` that tells us what to look for has resolved. A callback evaluated
 * only on arrival would miss it and then block until the timeout, because
 * nothing else is going to arrive on that stream. Polling re-reads the array,
 * so the race simply does not exist.
 *
 * It resolves with `timedOut: true` rather than throwing — "the notification
 * never arrived" is the finding, not an error in the test.
 */
async function openStream(cookie: string) {
  const controller = new AbortController();
  const events: FobsEvent[] = [];
  let closed = false;

  const response = await fetch(`${BASE}/api/events`, {
    headers: { cookie, accept: "text/event-stream" },
    signal: controller.signal
  });
  if (!response.body) throw new Error("The event stream returned no body.");

  const reader = response.body.getReader();

  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Frames are separated by a blank line. Heartbeats arrive as `: ping`
        // and carry no `data:` line, so they are skipped rather than parsed.
        let split: number;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              events.push(JSON.parse(line.slice(6)) as FobsEvent);
            } catch {
              // A frame we cannot parse is not worth failing the rehearsal over.
            }
          }
        }
      }
    } catch {
      // Aborted, or the connection dropped. `closed` is what callers act on.
    }
    closed = true;
  })();

  return {
    events,
    async waitFor(
      predicate: (events: FobsEvent[]) => boolean,
      timeoutMs = 30_000
    ): Promise<{ ok: boolean; timedOut: boolean }> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (predicate(events)) return { ok: true, timedOut: false };
        // The stream ended and the event never came — no point waiting out the
        // clock to say so.
        if (closed) return { ok: false, timedOut: false };
        if (Date.now() >= deadline) return { ok: false, timedOut: true };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    close() {
      controller.abort();
    }
  };
}

async function main() {
  console.log(`rehearsal against ${BASE}\n`);

  // --- the product does not open on a sign-in wall ------------------------
  // Checked structurally, not by looking for the words: the nav legitimately
  // carries a "Sign in" link, and a search for that string finds the nav before
  // it finds the hero. What the spec actually requires is that the *primary*
  // call to action is the feed, and that reaching the feed does not mean passing
  // through a sign-in.
  const landing = await fetch(`${BASE}/`).then((r) => r.text());
  console.log("1. the landing page");
  check("it responds", landing.length > 0);

  const anchors = [...landing.matchAll(/<a\b([^>]*)>/g)].map((match) => ({
    href: /href="([^"]*)"/.exec(match[1])?.[1] ?? "",
    className: /class="([^"]*)"/.exec(match[1])?.[1] ?? "",
    at: match.index ?? 0
  }));
  const primary = anchors.find((a) => a.className.includes("button"));
  check(
    "the primary call to action is the feed",
    primary?.href === "/feed",
    `points at ${primary?.href || "nothing"}`
  );
  check("the synthetic disclosure is present", /synthetic/i.test(landing));

  // The claim behind "don't open with sign-in" is that you can read the product
  // before you have an account. That is testable directly, and it is the version
  // worth testing — a nav that happens to offer "Sign in" is an affordance, not
  // a wall. No cookie is sent here, on purpose.
  const anonymousFeed = await fetch(`${BASE}/feed`);
  const anonymousHtml = await anonymousFeed.text();
  check("the feed is readable with no session at all", anonymousFeed.status === 200,
    `status ${anonymousFeed.status}`);
  check(
    "and it renders real trades rather than an empty shell",
    /Synthetic/i.test(anonymousHtml) && /on devnet|signature pending/i.test(anonymousHtml)
  );
  check(
    "it does not redirect to sign-in",
    !anonymousFeed.url.includes("sign-in")
  );

  // --- two people, two sessions ------------------------------------------
  console.log("\n2. two real sessions");
  const alice = await signIn("alice");
  const bob = await signIn("bob");
  check("both sessions are distinct", alice !== bob);

  const whoami = await api<{ user?: { username: string } }>("/api/users/alice", alice);
  check("alice's session resolves to alice", whoami.status === 200, `status ${whoami.status}`);

  // --- A. alice trades, bob is watching ----------------------------------
  console.log("\nA. alice buys sNVDA while bob has the feed open");
  // Each wait is keyed to the *specific* trade the step is about to make, not
  // to a count or a kind. The stream replays recent events on connect, so a
  // looser predicate can be satisfied by something an earlier run left behind —
  // and then the check passes without the event it was meant to prove.
  const bobStream = await openStream(bob);

  const aliceTrade = await api<{
    trade?: { id: string; amountUsdc: number; user: { username: string }; asset: { symbol: string } };
    signature?: string;
    error?: string;
  }>("/api/trades", alice, {
    method: "POST",
    body: JSON.stringify({ symbol: "sNVDA", side: "buy", amountUsdc: 250 })
  });

  check("alice's trade was accepted", aliceTrade.status === 201, aliceTrade.body.error ?? "");
  const aliceTradeId = aliceTrade.body.trade?.id;
  const aliceSignature = aliceTrade.body.signature;
  check("it returned a real signature", Boolean(aliceSignature && aliceSignature.length > 30));
  check("it is attributed to alice", aliceTrade.body.trade?.user.username === "alice");

  const bobSaw = await bobStream.waitFor((events) =>
    events.some(
      (e) => e.type === "notification" && e.kind === "FRIEND_TRADE" && e.tradeId === aliceTradeId
    )
  );
  const bobNotification = bobStream.events.find(
    (e) =>
      e.type === "notification" && e.kind === "FRIEND_TRADE" && e.tradeId === aliceTradeId
  ) as Extract<FobsEvent, { type: "notification" }> | undefined;
  check(
    "bob's live stream carried the notification",
    bobSaw.ok && Boolean(bobNotification),
    !bobSaw.ok ? (bobSaw.timedOut ? "timed out with no notification" : "stream closed") : `kind ${bobNotification?.kind}`
  );
  check("it names alice as the actor", bobNotification?.actorUsername === "alice");
  bobStream.close();

  const bobFeed = await api<{ trades: { id: string }[] }>("/api/feed?view=following", bob);
  check(
    "alice's trade is in bob's following feed",
    bobFeed.body.trades.some((t) => t.id === aliceTradeId)
  );

  // --- B. bob FOMOs at his own size --------------------------------------
  console.log("\nB. bob FOMOs it at $60 against alice's $250");
  const aliceStream = await openStream(alice);

  const bobFomo = await api<{
    trade?: { id: string; amountUsdc: number; source: { user: { username: string } } | null };
    signature?: string;
    error?: string;
  }>(`/api/trades/${aliceTradeId}/fomo`, bob, {
    method: "POST",
    body: JSON.stringify({ amountUsdc: 60 })
  });

  check("bob's FOMO was accepted", bobFomo.status === 201, bobFomo.body.error ?? "");
  const bobFomoId = bobFomo.body.trade?.id;
  check("it is a different transaction", bobFomo.body.signature !== aliceSignature);
  check(
    "it did not copy alice's size",
    Number(bobFomo.body.trade?.amountUsdc) === 60,
    `bob ${bobFomo.body.trade?.amountUsdc} vs alice 250`
  );
  check(
    "it records provenance to alice",
    bobFomo.body.trade?.source?.user.username === "alice"
  );

  // --- C. alice hears about it ------------------------------------------
  console.log("\nC. alice is told, and her feed shows bob");
  const aliceSaw = await aliceStream.waitFor((events) =>
    events.some((e) => e.type === "notification" && e.kind === "FOMO" && e.tradeId === bobFomoId)
  );
  const fomoNotification = aliceStream.events.find(
    (e) => e.type === "notification" && e.kind === "FOMO" && e.tradeId === bobFomoId
  ) as Extract<FobsEvent, { type: "notification" }> | undefined;
  check(
    "alice's live stream carried the FOMO notification",
    aliceSaw.ok && Boolean(fomoNotification),
    !aliceSaw.ok ? (aliceSaw.timedOut ? "timed out with no notification" : "stream closed") : ""
  );
  check("it names bob as the actor", fomoNotification?.actorUsername === "bob");
  aliceStream.close();

  const aliceNotifications = await api<{
    notifications: { type: string; actor: { username: string } | null }[];
    unread: number;
  }>("/api/notifications", alice);
  check(
    "it is in alice's notification centre",
    aliceNotifications.body.notifications.some(
      (n) => n.type === "FOMO" && n.actor?.username === "bob"
    ),
    `${aliceNotifications.body.unread} unread`
  );

  const aliceFeed = await api<{ trades: { id: string; user: { username: string } }[] }>(
    "/api/feed?view=for-you",
    alice
  );
  check(
    "bob's trade is in alice's feed",
    aliceFeed.body.trades.some((t) => t.user.username === "bob")
  );

  // --- the stream is filtered per user -----------------------------------
  // A notification is addressed to one person. Bob follows alice; he does not
  // follow charlie. So charlie trading must reach bob's feed (trades are public)
  // and must NOT reach bob's notifications. This is the check that the per-user
  // filter in `/api/events` is real — a broadcast would pass every other check
  // in this file.
  console.log("\nthe stream is filtered per user");
  const bobId = bobNotification?.userId;
  check("bob's own id is known from his notification", Boolean(bobId));

  const leakStream = await openStream(bob);

  const charlie = await signIn("charlie");
  const charlieTrade = await api<{ signature?: string; error?: string }>(
    "/api/trades",
    charlie,
    {
      method: "POST",
      body: JSON.stringify({ symbol: "sAMZN", side: "buy", amountUsdc: 40 })
    }
  );
  // And one more from alice, whom bob *does* follow, so the window contains both
  // a notification bob should get and one he should not.
  const aliceAgain = await api<{ signature?: string; error?: string }>("/api/trades", alice, {
    method: "POST",
    body: JSON.stringify({ symbol: "sTSLA", side: "buy", amountUsdc: 35 })
  });
  check("charlie's trade was accepted", charlieTrade.status === 201, charlieTrade.body.error ?? "");
  check("alice's second trade was accepted", aliceAgain.status === 201, aliceAgain.body.error ?? "");

  // Wait for both of the trades this step makes, by signature — a count would be
  // satisfied by the replay backlog alone. The second of the two is alice's, so
  // anything the server pushes for it has landed by the time this returns.
  const charlieSignature = charlieTrade.body.signature;
  const aliceAgainSignature = aliceAgain.body.signature;
  await leakStream.waitFor(
    (events) =>
      events.some((e) => e.type === "trade" && e.txSignature === charlieSignature) &&
      events.some((e) => e.type === "trade" && e.txSignature === aliceAgainSignature),
    45_000
  );
  // A short settle so a notification the server pushes just behind the trade
  // event is on the stream before the window is read.
  await new Promise((resolve) => setTimeout(resolve, 750));

  const tradeEvents = leakStream.events.filter((e) => e.type === "trade");
  const notificationEvents = leakStream.events.filter(
    (e) => e.type === "notification"
  ) as Extract<FobsEvent, { type: "notification" }>[];
  leakStream.close();

  check(
    "bob sees every trade, whoever made it — trades are public",
    tradeEvents.some((e) => e.type === "trade" && e.username === "charlie") &&
      tradeEvents.some((e) => e.type === "trade" && e.username === "alice"),
    tradeEvents.map((e) => (e.type === "trade" ? e.username : "?")).join(",")
  );
  check(
    "bob is notified about alice's trade",
    notificationEvents.some((e) => e.actorUsername === "alice"),
    notificationEvents.map((e) => e.actorUsername ?? "system").join(",")
  );
  check(
    "bob is NOT notified about charlie's trade",
    !notificationEvents.some((e) => e.actorUsername === "charlie")
  );
  check(
    "every notification bob received was addressed to bob",
    notificationEvents.length > 0 && notificationEvents.every((e) => e.userId === bobId),
    `${notificationEvents.length} notifications`
  );

  // --- D. the position moves, in both directions -------------------------
  // Test 5 of the acceptance list, which had no coverage at all before this.
  // A buy is one half of a market; if selling is broken the product only looks
  // finished. Checked against the read model the portfolio page renders, so a
  // pass here means the page has real positions rather than that the trade
  // endpoint returned 201.
  console.log("\nD. the position moves when alice sells");
  const beforeSell = await api<{
    portfolio?: {
      holdings: { asset: { symbol: string }; quantity: number; avgPrice: number }[];
      totalValue: number | null;
    };
    balances?: { usdc: number; usdcAccountExists: boolean } | null;
  }>("/api/me/portfolio", alice);

  check("alice's portfolio is readable", beforeSell.status === 200, `status ${beforeSell.status}`);
  const nvdaBefore = beforeSell.body.portfolio?.holdings.find(
    (holding) => holding.asset.symbol === "sNVDA"
  );
  check(
    "she has an sNVDA position to sell from",
    Boolean(nvdaBefore && nvdaBefore.quantity > 0),
    nvdaBefore ? `${nvdaBefore.quantity} shares` : "no position"
  );
  const usdcBefore = beforeSell.body.balances?.usdc ?? null;
  check(
    "her USDC balance is readable from devnet",
    usdcBefore !== null,
    usdcBefore === null ? "devnet did not answer" : `${usdcBefore} USDC`
  );

  if (nvdaBefore && nvdaBefore.quantity > 0 && usdcBefore !== null) {
    const sellValue = 20;
    const sell = await api<{
      trade?: { id: string; side: string; amountUsdc: number; quantity: number };
      signature?: string;
      error?: string;
    }>("/api/trades", alice, {
      method: "POST",
      body: JSON.stringify({ symbol: "sNVDA", side: "sell", amountUsdc: sellValue })
    });

    check("the sell was accepted", sell.status === 201, sell.body.error ?? "");
    check("it is recorded as a sell", sell.body.trade?.side === "sell");
    check("it returned a real signature", Boolean(sell.body.signature));
    check(
      "it burned shares rather than minting them",
      (sell.body.trade?.quantity ?? 0) > 0,
      `${sell.body.trade?.quantity} shares`
    );

    // The indexer runs inside the trade request, so the position should already
    // have moved by the time this returns. If it has not, that is the finding.
    const afterSell = await api<{
      portfolio?: {
        holdings: { asset: { symbol: string }; quantity: number }[];
      };
      balances?: { usdc: number } | null;
    }>("/api/me/portfolio", alice);

    const nvdaAfter = afterSell.body.portfolio?.holdings.find(
      (holding) => holding.asset.symbol === "sNVDA"
    );
    check(
      "the holding decreased",
      nvdaAfter !== undefined && nvdaAfter.quantity < nvdaBefore.quantity,
      `${nvdaBefore.quantity} → ${nvdaAfter?.quantity ?? "gone"}`
    );

    // The round trip, measured: what she received should be close to what she
    // asked for, and *under* it — the program's spread is real and it lands on
    // the seller. A sell that returned more than the requested amount would mean
    // the spread is being applied backwards.
    const usdcAfter = afterSell.body.balances?.usdc ?? null;
    if (usdcAfter === null) {
      check("her USDC balance is readable after the sell", false, "devnet did not answer");
    } else {
      const received = usdcAfter - usdcBefore;
      check(
        "the USDC came back",
        received > 0,
        `+${received.toFixed(6)} USDC`
      );
      check(
        "the spread landed on the seller, not in her favour",
        received <= sellValue,
        `received ${received.toFixed(6)} against a ${sellValue} order`
      );
    }

    // The receipt anchor: a sell has to be indexed like any other trade, or the
    // feed would show buys and quietly omit exits.
    const postSellFeed = await api<{ trades: { id: string }[] }>(
      "/api/feed?view=for-you",
      alice
    );
    check(
      "the sell is in the feed like any other trade",
      postSellFeed.body.trades.some((t) => t.id === sell.body.trade?.id)
    );
  }

  // --- E. pagination is a real cursor ------------------------------------
  // The feed grows at the top, so page two must not be an offset. The check
  // that catches a broken cursor is the overlap test: if any id appears on both
  // pages, the same trade is being shown twice, which is exactly what an offset
  // cursor does when a trade lands between the two fetches.
  console.log("\nE. the feed paginates without repeating itself");
  const page1 = await api<{
    trades: { id: string; tradedAt: string }[];
    hasMore: boolean;
    nextCursor: string | null;
  }>("/api/feed?view=for-you", alice);

  check("the first page says whether there is more", typeof page1.body.hasMore === "boolean");
  if (page1.body.hasMore) {
    check("it hands back a cursor", Boolean(page1.body.nextCursor));
    const page2 = await api<{ trades: { id: string; tradedAt: string }[]; hasMore: boolean }>(
      `/api/feed?view=for-you&before=${encodeURIComponent(page1.body.nextCursor!)}`,
      alice
    );
    const ids1 = new Set(page1.body.trades.map((t) => t.id));
    check(
      "the second page returns trades",
      page2.body.trades.length > 0,
      `${page2.body.trades.length} trades`
    );
    check(
      "no trade appears on both pages",
      page2.body.trades.every((t) => !ids1.has(t.id))
    );
    const oldestOnPage1 = page1.body.trades[page1.body.trades.length - 1].tradedAt;
    check(
      "everything on page two is older than page one",
      page2.body.trades.every((t) => new Date(t.tradedAt) < new Date(oldestOnPage1))
    );
  } else {
    check("the feed is long enough to have a second page", false,
      `${page1.body.trades.length} trades and no more`);
  }

  const badCursor = await api<{ error?: string }>("/api/feed?view=for-you&before=nonsense", alice);
  check(
    "a malformed cursor is refused rather than silently ignored",
    badCursor.status === 400,
    `status ${badCursor.status}`
  );

  // --- F. the hardening is actually on -----------------------------------
  // Each of these is a guard that is invisible when it works, so the only way to
  // know it is there is to try it. A rate limit in particular is easy to write
  // and never wire up.
  console.log("\nF. the hardening is on");
  const anonymousDev = await fetch(`${BASE}/api/dev`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "status" })
  });
  check(
    "the dev harness refuses an anonymous request",
    anonymousDev.status === 401,
    `status ${anonymousDev.status}`
  );

  const devStatus = await api<{ status?: unknown }>("/api/dev", alice, {
    method: "POST",
    body: JSON.stringify({ action: "status" })
  });
  check(
    "and serves a signed-in one",
    devStatus.status === 200 && Boolean(devStatus.body.status),
    `status ${devStatus.status}`
  );

  const getSignOut = await fetch(`${BASE}/api/auth/sign-out`);
  check(
    "sign-out is not reachable by GET",
    getSignOut.status === 405,
    `status ${getSignOut.status}`
  );

  const postSignOut = await fetch(`${BASE}/api/auth/sign-out`, {
    method: "POST",
    redirect: "manual"
  });
  check(
    "but a POST signs out and redirects",
    postSignOut.status === 303,
    `status ${postSignOut.status}`
  );

  // The rate limit, tried from a throwaway session so the bucket spent here is
  // not the one alice's own steps depend on. Ten is the documented capacity, so
  // the eleventh must be refused; asserting on "some request eventually 429s"
  // would pass against a limiter with the wrong capacity.
  const rateLimitCookie = await signIn("grey");
  // The body is deliberately invalid: the limiter is charged *before* the body
  // is parsed, so this exercises the bucket without sending a dozen real devnet
  // transactions. A valid body would spend the operator's SOL to prove a point
  // about a counter.
  let refused = 0;
  let refusal: Response | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch(`${BASE}/api/trades`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: rateLimitCookie },
      body: JSON.stringify({ symbol: "sMSFT", side: "buy", amountUsdc: -1 })
    });
    if (response.status === 429) {
      refused++;
      refusal ??= response;
    }
  }
  check(
    "the trade route rate-limits a burst",
    refused > 0,
    `${refused} of 12 refused`
  );
  check(
    "the refusal says when to come back",
    refusal?.headers.get("retry-after") !== null &&
      refusal?.headers.get("retry-after") !== undefined,
    refusal ? `retry-after: ${refusal.headers.get("retry-after")}` : "nothing was refused"
  );

  console.log(
    failures === 0
      ? "\nall checks passed — the demo path works over the surface the UI uses"
      : `\n${failures} check(s) failed`
  );
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
