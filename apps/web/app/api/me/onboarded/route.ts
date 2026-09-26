import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Mark the signed-in account as having seen the first-run walkthrough.
 *
 * `onboardedAt` is the single source of truth for "has this account been shown
 * the tour" — `currentUser` derives `onboarded` from it, and the signed-in
 * layout renders the walkthrough only while it is false. This route is the one
 * place that stamps it.
 *
 * The write is a conditional `updateMany` (where `onboardedAt: null`) rather than
 * an `update`, so it is idempotent: a second POST — from a double click, a
 * finish-then-skip race, or a stale tab — changes nothing and does not move the
 * timestamp. It records the moment the tour was first dismissed, not the last.
 */
export async function POST() {
  const viewer = await currentUser();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  await prisma.user.updateMany({
    where: { id: viewer.id, onboardedAt: null },
    data: { onboardedAt: new Date() }
  });

  return NextResponse.json({ onboarded: true });
}
