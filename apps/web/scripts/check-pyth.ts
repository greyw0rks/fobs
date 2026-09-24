/**
 * The deviation guard must refuse — and refuse the right things.
 *
 * Run: `pnpm check:pyth`
 *
 * `pyth:guard` shows the guard passing on live routes, which is the easy half.
 * This asserts the half that matters: that a venue priced against something
 * other than the share is refused, that a tolerance is actually honoured, and
 * that a reference which has stopped is not silently treated as a reference.
 *
 * ## Why these assertions are relative, not absolute
 *
 * Prices move, so nothing here compares against a remembered number. Every case
 * is built from the reference read *during the run* — "26% below the reference"
 * rather than "$180". A test that hardcoded $222.51 would start failing on
 * Monday's open and would be quietly deleted rather than fixed, which is how a
 * guard stops being tested.
 *
 * Live network, deliberately. The behaviour worth testing is what this does
 * against a real Pyth account and a real market schedule, and every failure mode
 * it has — offsets, encodings, exponents, staleness — only exists because the
 * data is real. It exits non-zero when the reference cannot be read at all, since
 * then nothing was verified.
 */

import { DEFAULT_TOLERANCE_BPS, checkDeviation } from "@/lib/server/deviation";
import {
  referencePrice,
  classify,
  MAX_CLOSURE_AGE_SECS,
  type MarketHours
} from "@/lib/server/pyth-reference";

const SYMBOL = "NVDA";

let failed = 0;

function check(name: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`ok   ${name}`);
    return;
  }
  failed += 1;
  console.log(`FAIL ${name}\n     ${detail}`);
}

async function main(): Promise<void> {
  const reference = await referencePrice(SYMBOL);
  console.log(
    `${SYMBOL} reference $${reference.price.toFixed(2)} (${reference.freshness.state}, ` +
      `${reference.ageSecs}s old), tolerance ${DEFAULT_TOLERANCE_BPS}bps\n`
  );

  const cases: Array<{
    name: string;
    price: number;
    toleranceBps?: number;
    verdict: string;
    allowed: boolean;
  }> = [
    {
      name: "a venue tracking the reference passes",
      price: reference.price * 0.999,
      verdict: "ok",
      allowed: true
    },
    {
      name: "a venue 0.6% rich passes",
      price: reference.price * 1.006,
      verdict: "ok",
      allowed: true
    },
    {
      name: "a venue 26% cheap is refused",
      price: reference.price * 0.74,
      verdict: "dislocated",
      allowed: false
    },
    {
      name: "a venue 26% rich is refused",
      price: reference.price * 1.26,
      verdict: "dislocated",
      allowed: false
    },
    {
      name: "a decimals error — 100x — is refused",
      price: reference.price * 100,
      verdict: "dislocated",
      allowed: false
    },
    {
      name: "an explicit wider tolerance is honoured",
      price: reference.price * 0.74,
      toleranceBps: 3_000,
      verdict: "ok",
      allowed: true
    },
    {
      name: "an explicit tighter tolerance is enforced",
      price: reference.price * 1.006,
      toleranceBps: 10,
      verdict: "dislocated",
      allowed: false
    }
  ];

  for (const testCase of cases) {
    const check_ = await checkDeviation({
      symbol: SYMBOL,
      impliedPrice: testCase.price,
      toleranceBps: testCase.toleranceBps
    });
    check(
      testCase.name,
      check_.verdict === testCase.verdict && check_.allowed === testCase.allowed,
      `expected ${testCase.verdict}/${testCase.allowed ? "allow" : "refuse"}, ` +
        `got ${check_.verdict}/${check_.allowed ? "allow" : "refuse"} — ${check_.reason}`
    );
  }

  /**
   * The distinction the whole module turns on. The same feed at the same price,
   * read under a clock far enough ahead that no market closure can explain the
   * age, must stop being a reference rather than become a permissive one.
   */
  const nowSeconds = Math.floor(Date.now() / 1000);
  const farFuture = await checkDeviation({
    symbol: SYMBOL,
    impliedPrice: reference.price,
    nowSeconds: nowSeconds + 10 * 86_400
  });
  check(
    "a reference older than any market closure is unchecked, not trusted",
    farFuture.verdict === "unchecked" && !farFuture.allowed,
    `got ${farFuture.verdict}/${farFuture.allowed ? "allow" : "refuse"} — ${farFuture.reason}`
  );
  check(
    "an unchecked reference reports no deviation rather than a zero one",
    farFuture.deviationBps === null,
    `deviationBps was ${farFuture.deviationBps}`
  );

  /**
   * The freshness rule itself, asserted as pure logic rather than through a live
   * feed — because a feed's answer depends on whether the market is open *right
   * now*, which is exactly why the long-weekend case used to pass only on
   * weekends. `classify` is the whole three-state rule; these pin it to the clock
   * we choose, not the one the test happens to run under.
   */
  const closed: MarketHours = { isOpen: false, nextOpen: nowSeconds + 86_400, nextClose: null };
  const open: MarketHours = { isOpen: true, nextOpen: null, nextClose: nowSeconds + 86_400 };
  const threeDays = 3 * 86_400;

  check(
    "a long-weekend-old reference is still usable",
    classify(threeDays, closed).state === "closed",
    `got ${classify(threeDays, closed).state}`
  );
  check(
    "the same age with the market open is stale, not a last close",
    classify(threeDays, open).state === "stale",
    `got ${classify(threeDays, open).state}`
  );
  check(
    "an age beyond any closure is stale even with the market shut",
    classify(MAX_CLOSURE_AGE_SECS + 86_400, closed).state === "stale",
    `got ${classify(MAX_CLOSURE_AGE_SECS + 86_400, closed).state}`
  );

  console.log();
  if (failed > 0) {
    console.log(`${failed} of ${cases.length + 5} failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`${cases.length + 5}/${cases.length + 5} ok`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
