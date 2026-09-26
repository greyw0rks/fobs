"use client";

// components/fobs/walkthrough.tsx
//
// The first-run walkthrough — a short guided tour of the whole app and what it
// is *for*, shown once to a freshly registered account. The signed-in layout
// mounts it only while `user.onboarded` is false and a wallet is connected, so
// it lands the moment onboarding finishes rather than interrupting the connect
// step. Finishing or skipping stamps `onboardedAt` (POST /api/me/onboarded) and
// refreshes the layout, which then stops rendering it.
//
// Voice matches the rest of fobs: precise about no-custody, and it never claims
// a figure the app would not. Motion honours prefers-reduced-motion.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeftRight,
  Bell,
  House,
  KeyRound,
  LineChart,
  Users,
  Wallet,
  type LucideIcon
} from "lucide-react";
import { api } from "@/lib/api";

/**
 * Fired to replay the tour on demand (the "Replay walkthrough" control on the
 * account page). The walkthrough is always mounted for a signed-in viewer and
 * listens for this, so a replay works from any route without a URL param to
 * clean up afterwards. `replayWalkthrough()` is the only thing that should
 * dispatch it.
 */
export const REPLAY_WALKTHROUGH_EVENT = "fobs:replay-walkthrough";

export function replayWalkthrough() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(REPLAY_WALKTHROUGH_EVENT));
  }
}

type Step = {
  icon: LucideIcon;
  tag: string;
  /** Soft token colour behind the icon; purely decorative. */
  tint: string;
  title: string;
  body: React.ReactNode;
};

const STEPS: Step[] = [
  {
    icon: Users,
    tag: "Welcome",
    tint: "#dfd2f2",
    title: "fobs is the room.",
    body: (
      <>
        Follow real traders, see what they actually paid, and open your own trade
        at your own size. Every trade here is a real swap on Solana mainnet, signed
        by your own wallet — <strong>fobs issues nothing, holds no key, and takes
        no custody.</strong>
      </>
    )
  },
  {
    icon: House,
    tag: "Home",
    tint: "#dceafa",
    title: "The feed is your front door.",
    body: (
      <>
        <strong>Following</strong> shows the real trades of the people you follow,
        newest first; <strong>For You</strong> widens it out. Every figure is read
        from the chain, never invented — a price fobs hasn&apos;t seen shows a dash,
        not a guess.
      </>
    )
  },
  {
    icon: LineChart,
    tag: "Markets",
    tint: "#dcece3",
    title: "Real tokens, live prices.",
    body: (
      <>
        Tokenized equities that trade on mainnet and that fobs reaches through
        Jupiter. Each price is read live — a Jupiter route or a Pyth reference —
        not from anything fobs controls. Open a market to see its detail and trade
        it.
      </>
    )
  },
  {
    icon: ArrowLeftRight,
    tag: "Trading",
    tint: "#f5ddd2",
    title: "Every trade is a swap you sign.",
    body: (
      <>
        fobs builds the route and forwards it; your wallet signs it. When someone
        else&apos;s trade gives you FOMO, you open <em>your own</em> at your own
        size — provenance, not copy-trading. fobs can never move your funds.
      </>
    )
  },
  {
    icon: Wallet,
    tag: "Portfolio",
    tint: "#dceee5",
    title: "Positions mirrored from chain.",
    body: (
      <>
        Your holdings and average entry prices are read from the program&apos;s own
        accounts; your wallet balance is read live each visit. What you see is what
        the chain says you hold — nothing is accumulated from guesswork.
      </>
    )
  },
  {
    icon: Bell,
    tag: "Social",
    tint: "#f2e8bd",
    title: "Following is the product.",
    body: (
      <>
        Who you follow decides your feed and who gets told when you trade.
        Notifications show who traded and who followed you — the loop, as it
        happens.
      </>
    )
  },
  {
    icon: KeyRound,
    tag: "Your keys",
    tint: "#dceafa",
    title: "You're set — no custody, ever.",
    body: (
      <>
        Your wallet is connected by a signature; this server never stored a key for
        you. Sign out any time and your funds stay entirely yours. Welcome in.
      </>
    )
  }
];

/**
 * @param firstRun true for a freshly registered account that has never seen the
 *   tour. It then opens immediately and, when dismissed, stamps `onboardedAt`
 *   and refreshes the layout. A replay (firstRun false, opened via the event)
 *   just shows and closes — the account is already onboarded, so there is
 *   nothing to persist.
 */
export function Walkthrough({ firstRun = false }: { firstRun?: boolean }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(firstRun);
  const [busy, setBusy] = useState(false);
  // A first-run tour persists exactly once; a replay never does.
  const persistOnDismiss = useRef(firstRun);

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  // Finish or skip both land here: close, and — only for the first run — stamp
  // it seen and refresh the layout. A failed POST is swallowed; the tour
  // reappearing next load beats trapping someone behind a network error.
  const dismiss = useCallback(async () => {
    if (busy) return;
    setOpen(false);
    if (!persistOnDismiss.current) return;
    persistOnDismiss.current = false;
    setBusy(true);
    try {
      await api.completeOnboarding();
    } catch {
      // non-fatal, see above
    }
    router.refresh();
  }, [busy, router]);

  const back = () => setIndex((i) => Math.max(0, i - 1));
  const next = () => {
    if (isLast) void dismiss();
    else setIndex((i) => i + 1);
  };

  // Replay from anywhere: rewind to the first step and open. This is a no-op
  // persistence-wise — a replayer is already onboarded.
  useEffect(() => {
    const onReplay = () => {
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(REPLAY_WALKTHROUGH_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_WALKTHROUGH_EVENT, onReplay);
  }, []);

  // Escape skips the tour. Body scroll is locked only while it's actually open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void dismiss();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, dismiss]);

  if (typeof document === "undefined") return null;

  const Icon = step.icon;

  const overlay = (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-[#111312]/35 p-4 backdrop-blur-sm sm:items-center"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.2 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="fobs-walkthrough-title"
        >
          <motion.div
            className="w-full max-w-[500px] overflow-hidden rounded-[24px] border border-[#e3e2dc] bg-white shadow-[0_24px_70px_-24px_rgba(17,19,18,0.35)]"
            initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="p-7 sm:p-8">
              <div className="flex items-center justify-between">
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-full"
                  style={{ background: step.tint }}
                >
                  <Icon size={19} strokeWidth={1.8} className="text-[#111312]" />
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a8b84]">
                  {step.tag} · {index + 1}/{STEPS.length}
                </span>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={index}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <h2
                    id="fobs-walkthrough-title"
                    className="mt-6 text-[26px] font-semibold leading-tight tracking-[-0.05em] text-[#111312]"
                  >
                    {step.title}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-[#5c5d57]">{step.body}</p>
                </motion.div>
              </AnimatePresence>

              <div className="mt-7 flex items-center gap-1.5" aria-hidden="true">
                {STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      i === index ? "w-6 bg-[#080909]" : "w-1.5 bg-[#dcdbd4]"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[#eeede8] bg-[#f8f7f3] px-7 py-4 sm:px-8">
              <button
                type="button"
                onClick={() => void dismiss()}
                disabled={busy}
                className="text-[13px] font-medium text-[#8a8b84] transition hover:text-[#5c5d57] disabled:opacity-50"
              >
                Skip tour
              </button>

              <div className="flex items-center gap-2">
                {index > 0 ? (
                  <button
                    type="button"
                    onClick={back}
                    disabled={busy}
                    className="fobs-button-secondary disabled:opacity-50"
                  >
                    Back
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={next}
                  disabled={busy}
                  className="fobs-button-primary disabled:opacity-50"
                >
                  {isLast
                    ? busy
                      ? "Finishing…"
                      : firstRun
                        ? "Enter fobs"
                        : "Done"
                    : "Next"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return createPortal(overlay, document.body);
}
