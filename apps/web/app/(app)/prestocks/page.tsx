import type { Route } from "next";
import Link from "next/link";
import { actionable, premiumSurface, summarize, type PremiumRow } from "@/lib/server/premium";
import { prestocksPositions, type PreStocksPositions } from "@/lib/server/prestocks-positions";
import { Reveal, Stagger, StaggerItem } from "@/components/fobs/motion";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Pre-IPO equity, routed rather than issued. Eight PreStocks tokens that trade
 * on mainnet and that this app reaches through Jupiter. Nothing here is issued
 * by fobs, and the page refuses to call a discount a discount when the round
 * trip eats it — so the sort puts what is actionable first.
 */

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function toneClass(tone: string): string {
  if (tone === "gain") return "text-[#23845b]";
  if (tone === "negative") return "text-[#c94c4c]";
  return "text-[#777872]";
}

function verdict(row: PremiumRow): { text: string; tone: string } {
  if (row.actionableLong) return { text: "discount clears costs", tone: "gain" };
  if (row.direction === "premium") return { text: "premium — not tradeable long-only", tone: "muted" };
  if (row.direction === "par") return { text: "at the mark", tone: "muted" };
  return { text: "discount, inside the round trip", tone: "muted" };
}

// A failure to reach the issuer is shown as a failure, not an empty table — an
// empty table would be a claim about the market made by our own outage.
async function readSurface() {
  try {
    return { ok: true as const, surface: await premiumSurface() };
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : String(error) };
  }
}

// The reason is carried rather than collapsed into a null: an unparseable
// address and an unreachable issuer both render as "nothing" and only one of
// them is a fact about the address.
async function readPositions(
  walletAddress: string
): Promise<{ ok: true; positions: PreStocksPositions } | { ok: false; reason: string }> {
  try {
    return { ok: true, positions: await prestocksPositions(walletAddress) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// `?wallet=` reads an address you name — this app custodies devnet keypairs,
// which cannot hold a mainnet token, so reading the viewer's own wallet has one
// possible answer. It never signs, so it can look at any mainnet holder.
export default async function PreStocksPage({
  searchParams
}: {
  searchParams: Promise<{ wallet?: string }>;
}) {
  const { wallet } = await searchParams;
  const address = wallet?.trim() ?? "";
  const result = await readSurface();
  const lookup = address === "" ? null : await readPositions(address);

  return (
    <div className="space-y-5">
      <Reveal>
        <section>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#898a84]">
            Mainnet · Token-2022 · read via Jupiter
          </span>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.05em]">Pre-IPO</h1>
          <p className="mt-1 text-sm text-[#777872]">
            Eight private-company tokens issued by PreStocks. This app does not mint them,
            custody them, or trade them — it reads their market, prices it against the
            issuer&apos;s own mark, and refuses to call a discount a discount when the round
            trip eats it.
          </p>
        </section>
      </Reveal>

      {result.ok ? (
        <>
          <Reveal delay={0.05} className="fobs-surface p-5">
            <strong className="text-sm font-semibold">{summarize(result.surface)}</strong>
            <p className="mt-1 text-xs text-[#777872]">
              Every one of these tokens charges a transfer fee, so getting in and back out
              is not free. A discount smaller than that round trip is not a discount you can
              keep.
            </p>
          </Reveal>

          <div className="fobs-surface overflow-hidden">
            <div className="hidden grid-cols-4 border-b border-[#e5e3dd] px-5 py-3 text-[10px] uppercase tracking-wide text-[#8b8c85] sm:grid">
              <span>Token</span>
              <span className="text-right">Vs. mark</span>
              <span className="text-right">Round trip</span>
              <span className="text-right">Net edge</span>
            </div>

            <Stagger>
              {result.surface.rows.map((row) => {
                const { text, tone } = verdict(row);
                return (
                  <StaggerItem
                    key={row.symbol}
                    className="border-b border-[#efeee9] last:border-b-0"
                  >
                    <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4 sm:items-start">
                      <div>
                        <div className="text-xs font-semibold">
                          {row.symbol}{" "}
                          <span className="rounded-md bg-[#f0efe9] px-1.5 py-0.5 text-[9px] font-medium text-[#777872]">
                            Routed
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] text-[#92938c]">
                          {text} · ×{row.multiplier.multiplier.toFixed(4)} {row.multiplier.source}
                          {row.issuerControls ? " · issuer can seize or halt" : ""}
                        </div>
                      </div>

                      <div className={`text-xs font-semibold sm:text-right ${toneClass(tone)}`}>
                        {signed(row.grossPremium)}
                        <div className="mt-0.5 text-[10px] font-normal text-[#92938c]">
                          mark {money(row.markPrice)} · token {money(row.tokenPrice)}
                        </div>
                      </div>

                      <div className="text-xs sm:text-right">
                        {(row.roundTripCost * 100).toFixed(2)}%
                        <div className="mt-0.5 text-[10px] text-[#92938c]">
                          {(row.feeBps / 100).toFixed(2)}% each way
                        </div>
                      </div>

                      <div
                        className={`text-xs font-semibold sm:text-right ${
                          row.actionableLong ? "text-[#23845b]" : "text-[#777872]"
                        }`}
                      >
                        {signed(row.netDislocation)}
                      </div>
                    </div>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </div>

          {result.surface.errors.length > 0 ? (
            <Reveal delay={0.1} className="fobs-surface p-5">
              <strong className="text-sm font-semibold">
                {result.surface.errors.length} token(s) could not be priced.
              </strong>
              <p className="mt-1 text-xs text-[#777872]">
                They are missing from the table rather than shown at a guessed value:{" "}
                {result.surface.errors.map((error) => error.symbol).join(", ")}.
              </p>
            </Reveal>
          ) : null}

          {actionable(result.surface.rows).length === 0 ? (
            <Reveal delay={0.1} className="fobs-surface p-5 text-xs leading-relaxed text-[#777872]">
              <strong className="font-semibold text-[#111312]">
                Nothing here clears its own round trip.
              </strong>{" "}
              That is the finding, not an error. The fee makes most of this market
              untouchable, and a page that hid that would be advertising.
            </Reveal>
          ) : null}
        </>
      ) : (
        <Reveal delay={0.05} className="fobs-surface p-5">
          <strong className="text-sm font-semibold">Could not read the Pre-IPO market.</strong>
          <p className="mt-1 text-xs text-[#777872]">{result.reason}</p>
          <p className="mt-1 text-xs text-[#777872]">
            An empty table would say this market has nothing in it. It does not; we could not
            ask.
          </p>
        </Reveal>
      )}

      <Reveal delay={0.15}>
        <section className="space-y-4">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#898a84]">
            Mainnet · read only · no signature
          </span>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">Look up a holder</h2>
          <p className="mt-1 text-sm text-[#777872]">
            Paste any mainnet wallet — your own or someone else&apos;s — to read its
            PreStocks holdings, priced the honest way: scaled by each mint&apos;s multiplier
            and shown net of the exit fee. This reads chain state only and signs nothing.
          </p>
        </div>

        <form method="get" action="/prestocks" className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="wallet"
            defaultValue={address}
            placeholder="Any mainnet wallet address"
            aria-label="Mainnet wallet address"
            className="min-w-0 flex-1 rounded-lg border border-[#e3e2dc] bg-white px-4 py-2.5 text-sm outline-none placeholder:text-[#999a93] focus:border-[#c9c8c1]"
          />
          <button type="submit" className="fobs-button-primary">
            Look up
          </button>
          {address !== "" ? (
            <Link
              href={"/prestocks" as Route}
              className="fobs-button-secondary inline-flex items-center"
            >
              Clear
            </Link>
          ) : null}
        </form>

        {lookup === null ? (
          <div className="fobs-surface p-5">
            <strong className="text-sm font-semibold">
              Nothing is read until you name an address.
            </strong>
            <p className="mt-1 text-xs text-[#777872]">
              Not your portfolio — this app has none of these to show you. Eight mints, each
              with its own multiplier and epoch fee schedule, is a real piece of arithmetic
              to get wrong, and the reason it is worth looking at is that the arithmetic is
              where the money quietly goes.
            </p>
          </div>
        ) : !lookup.ok ? (
          <div className="fobs-surface p-5">
            <strong className="text-sm font-semibold">Could not read that address.</strong>
            <p className="mt-1 text-xs text-[#777872]">{lookup.reason}</p>
            <p className="mt-1 text-xs text-[#777872]">
              Absent rather than empty — we did not get an answer.
            </p>
          </div>
        ) : lookup.positions.empty ? (
          <div className="fobs-surface p-5">
            <strong className="text-sm font-semibold">
              {lookup.positions.onCurve
                ? "That address holds none of the eight."
                : "That address is program-derived, not a wallet."}
            </strong>
            <p className="mt-1 text-xs text-[#777872]">
              {lookup.positions.onCurve
                ? "All eight mints were read and this address holds none of them."
                : "A program-derived address keeps its tokens in a vault rather than an associated token account, which is what this scan looks for. Not the same as holding nothing — just not something this check can see."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="fobs-surface p-5">
                <span className="text-[11px] uppercase tracking-wide text-[#898a84]">Value</span>
                <div className="mt-1 text-[22px] font-semibold tracking-[-0.03em]">
                  {money(lookup.positions.totalValueUsd)}
                </div>
              </div>
              <div className="fobs-surface p-5">
                <span className="text-[11px] uppercase tracking-wide text-[#898a84]">
                  If sold today
                </span>
                <div className="mt-1 text-[22px] font-semibold tracking-[-0.03em]">
                  {money(lookup.positions.totalExitValueUsd)}
                </div>
                <p className="mt-1 text-[11px] text-[#92938c]">
                  after the transfer fee on the way out —{" "}
                  {money(
                    lookup.positions.totalValueUsd - lookup.positions.totalExitValueUsd
                  )}
                </p>
              </div>
            </div>

            <div className="fobs-surface overflow-hidden">
              <div className="hidden grid-cols-4 border-b border-[#e5e3dd] px-5 py-3 text-[10px] uppercase tracking-wide text-[#8b8c85] sm:grid">
                <span>Holding</span>
                <span className="text-right">Value</span>
                <span className="text-right">Units</span>
                <span className="text-right">If sold</span>
              </div>

              <Stagger>
                {lookup.positions.positions.map((position) => (
                  <StaggerItem
                    key={position.mint}
                    className="border-b border-[#efeee9] last:border-b-0"
                  >
                    <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4 sm:items-start">
                      <div>
                        <div className="text-xs font-semibold">{position.symbol}</div>
                        <div className="mt-1 text-[10px] text-[#92938c]">
                          {position.issuerControls
                            ? "issuer can seize, freeze or halt"
                            : "no unilateral issuer controls"}
                        </div>
                      </div>

                      <div className="text-xs font-semibold sm:text-right">
                        {money(position.valueUsd)}
                      </div>

                      <div className="text-xs sm:text-right">
                        {position.scaledAmount.toLocaleString(undefined, {
                          maximumFractionDigits: 6
                        })}
                        {position.multiplier.multiplier !== 1 ? (
                          <div className="mt-0.5 text-[10px] text-[#92938c]">
                            ×{position.multiplier.multiplier.toFixed(4)} from{" "}
                            {position.rawTokens.toLocaleString(undefined, {
                              maximumFractionDigits: 6
                            })}{" "}
                            raw
                          </div>
                        ) : null}
                      </div>

                      <div className="text-xs sm:text-right">{money(position.exitValueUsd)}</div>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            </div>

            {lookup.positions.multiplierDisagreements.length > 0 ? (
              <div className="fobs-surface p-5">
                <strong className="text-sm font-semibold">
                  Multiplier drift on {lookup.positions.multiplierDisagreements.join(", ")}.
                </strong>
                <p className="mt-1 text-xs text-[#777872]">
                  The multiplier measured from the issuer&apos;s supply no longer matches the
                  mint&apos;s own config, so the units above may be priced against a stale
                  belief.
                </p>
              </div>
            ) : null}
          </div>
        )}
      </section>
      </Reveal>

      <Reveal delay={0.2}>
        <div className="space-y-4">
        <div className="fobs-surface p-5 text-xs leading-relaxed text-[#777872]">
          <strong className="font-semibold text-[#111312]">
            This page signs nothing — it is market intelligence.
          </strong>{" "}
          The surface and the holder lookup here are read-only: what you see is what the
          market is doing. Trading these tokens happens the same way as anything else on
          FOBS — a swap your own wallet signs — and FOBS holds no key and takes no custody in
          either case.
        </div>

        <div className="fobs-surface p-5 text-xs leading-relaxed text-[#777872]">
          <strong className="font-semibold text-[#111312]">These are not shares.</strong> Each
          token is issued by PreStocks and described by its issuer as backed by SPV exposure
          that tracks a private company. Holding one entitles you to nothing a share would —
          no vote, no dividend, no claim on the company. Every mint carries a permanent
          delegate and a freeze authority, so the issuer can move, freeze or halt your tokens
          without your signature.
        </div>

        <div className="fobs-surface p-5 text-xs leading-relaxed text-[#777872]">
          <strong className="font-semibold text-[#111312]">
            The mark is a reference, not a bid.
          </strong>{" "}
          Nothing redeems a token at the issuer&apos;s mark. The gap between the two can widen
          and stay wide, and these books are thin — on 2026-09-20 one company&apos;s pools
          held roughly $333k, so part of any dislocation is a liquidity artifact rather than a
          view on the business.
        </div>
      </div>
      </Reveal>
    </div>
  );
}
