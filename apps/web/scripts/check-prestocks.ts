/**
 * What the PreStocks adapter does when the issuer's endpoint misbehaves.
 *
 * Run: `pnpm check:prestocks`
 *
 * The endpoint at prestocks.com is public, unauthenticated, and flaky in three
 * distinct ways, each measured on 2026-09-20:
 *
 *   1. It is fronted by Vercel, which returns 429 after roughly three requests
 *      in a twenty-second window per IP — and the penalty is sticky, observed
 *      still biting seven requests and twenty seconds after it was tripped.
 *   2. It intermittently returns records with `tokenPrice` and `supply` nulled.
 *   3. It times out or drops connections under no particular provocation.
 *
 * Each needs a different response, and getting one wrong is invisible in normal
 * use — the failure modes all look like "the market is quiet". The first version
 * of the adapter retried 429s the same way it retried timeouts, which is the
 * exact wrong instinct: a retry is what *deepens* a rate limit.
 *
 * These cases stub `fetch`, so they assert on request *counts* as much as on
 * outcomes. That is the part worth guarding: it is easy to change a retry policy
 * and never notice that a single page render now costs four requests against an
 * endpoint that permits three.
 *
 * ## Why this re-executes itself
 *
 * The adapter holds two pieces of module state — the snapshot cache and the
 * rate-limit backoff — and the backoff test poisons the process for every test
 * after it. So each case runs in its own process, spawned from this file. Run
 * with no argument to run them all.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchPreStocks } from "@/lib/server/prestocks";

const FULL = [
  {
    name: "SpaceX",
    symbol: "SPACEX",
    contract_address: "Pre1",
    markPrice: 150,
    tokenPrice: 119,
    supply: 43_712
  },
  {
    name: "OpenAI",
    symbol: "OPENAI",
    contract_address: "Pre2",
    markPrice: 995,
    tokenPrice: 1_123,
    supply: 2_826
  }
];

/** The live defect, reproduced: one record's two priced fields nulled out. */
const PARTIAL = FULL.map((token, index) =>
  index === 1 ? { ...token, tokenPrice: null } : token
);

let calls = 0;

function install(make: (attempt: number) => Response | Promise<Response>): void {
  globalThis.fetch = (async () => {
    calls += 1;
    return make(calls);
  }) as unknown as typeof fetch;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function messageFrom(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const CASES: Record<string, () => Promise<void>> = {
  /**
   * The one that matters most. A 429 must cost exactly one request, and the
   * next call must not reach the network at all.
   */
  "rate limit is obeyed, not retried": async () => {
    install(() => new Response("Too Many Requests", { status: 429 }));

    const first = await messageFrom(() => fetchPreStocks());
    assert(first.includes("rate limited"), `first failure read: ${first}`);

    const second = await messageFrom(() => fetchPreStocks());
    assert(second.includes("still inside the backoff"), `second failure read: ${second}`);

    assert(calls === 1, `expected 1 request across two calls, made ${calls}`);
  },

  /** A partial read is worth one more ask; the fuller attempt wins. */
  "a partial read is retried once": async () => {
    install((attempt) => json(attempt === 1 ? PARTIAL : FULL));
    const tokens = await fetchPreStocks();
    assert(calls === 2, `expected 2 requests, made ${calls}`);
    assert(tokens.length === 2, `expected 2 tokens, got ${tokens.length}`);
  },

  /** Silence is the one failure where asking again is diligence. */
  "a request with no answer is retried once": async () => {
    install((attempt) =>
      attempt === 1 ? Promise.reject(new Error("socket hang up")) : json(FULL)
    );
    const tokens = await fetchPreStocks();
    assert(calls === 2, `expected 2 requests, made ${calls}`);
    assert(tokens.length === 2, `expected 2 tokens, got ${tokens.length}`);
  },

  /**
   * The case the whole reason-string exists for. A majority drop is an outage we
   * report, not a market we render — and the message must name the field, or the
   * next person sees "seven tokens vanished" and has nowhere to go.
   */
  "a wholesale shape change throws, naming the field": async () => {
    install(() =>
      json([
        { symbol: "SPACEX" },
        { symbol: "OPENAI" },
        { symbol: "ANTHROPIC" },
        { symbol: "KALSHI" }
      ])
    );
    const message = await messageFrom(() => fetchPreStocks());
    assert(message.includes("unparseable"), `failure read: ${message}`);
    assert(message.includes("tokenPrice"), `should name the missing field: ${message}`);
    assert(calls === 2, `expected only the one drop-retry, made ${calls}`);
  },

  /** A minority drop is a bad record, and the rest of the market still stands. */
  "one bad record is dropped, the rest survive": async () => {
    install(() => json([...FULL, { symbol: "BROKEN" }]));
    const tokens = await fetchPreStocks();
    assert(tokens.length === 2, `expected 2 tokens, got ${tokens.length}`);
    assert(calls === 2, `expected only the one drop-retry, made ${calls}`);
  }
};

function runAll(): void {
  const self = fileURLToPath(import.meta.url);
  let failed = 0;

  for (const name of Object.keys(CASES)) {
    const result = spawnSync(process.execPath, ["--import", "tsx", self, name], {
      stdio: "pipe",
      encoding: "utf8"
    });
    // The warning is expected in the minority-drop case and is part of the
    // behaviour, so it is passed through rather than swallowed.
    const warning = (result.stderr ?? "")
      .split("\n")
      .filter((line) => line.startsWith("[prestocks]"))
      .join("\n");

    if (result.status === 0) {
      console.log(`ok   ${name}`);
      if (warning) console.log(`     ${warning}`);
    } else {
      failed += 1;
      console.log(`FAIL ${name}`);
      console.log((result.stderr ?? "").trim() || `exit ${result.status}`);
    }
  }

  console.log();
  const total = Object.keys(CASES).length;
  if (failed > 0) {
    console.log(`${failed} of ${total} failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`${total}/${total} ok`);
}

const requested = process.argv.slice(2).find((arg) => !arg.startsWith("-"));

if (requested) {
  const test = CASES[requested];
  if (!test) throw new Error(`unknown case: ${requested}`);
  test().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
} else {
  runAll();
}
