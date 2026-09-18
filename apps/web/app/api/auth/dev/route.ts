import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  createSession,
  sessionCookieOptions,
  sessionExpiry
} from "@/lib/server/session";
import { devSignInAllowed } from "@/lib/server/x-oauth";

export const dynamic = "force-dynamic";

const Body = z.object({ username: z.string().min(1) });

/**
 * Dev sign-in: claim one of the seeded test accounts.
 *
 * This is the fallback for when X credentials are not configured, and it is the
 * one route in the app that hands out an identity without proving anything. It
 * is therefore gated twice: `devSignInAllowed()` refuses outright in a
 * production build, and it will only ever sign in as a user flagged
 * `isTestUser`, so it cannot be used to reach a real account's session even if
 * the gate were somehow passed.
 */
export async function POST(request: Request) {
  if (!devSignInAllowed()) {
    return NextResponse.json(
      { error: "Dev sign-in is disabled on this deployment." },
      { status: 403 }
    );
  }

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Username required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { username: parsed.data.username.replace(/^@/, "") },
    select: { id: true, username: true, isTestUser: true, walletAddress: true }
  });
  if (!user) return NextResponse.json({ error: "No such user" }, { status: 404 });
  if (!user.isTestUser) {
    return NextResponse.json(
      { error: "Dev sign-in only works for seeded test accounts." },
      { status: 403 }
    );
  }

  const sessionId = await createSession(user.id);
  const response = NextResponse.json({ user: { username: user.username } });
  response.cookies.set(SESSION_COOKIE, sessionId, sessionCookieOptions(sessionExpiry()));
  return response;
}
