import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

/**
 * Sessions as rows, not as signed tokens.
 *
 * A self-contained JWT would avoid a query per request, but it also cannot be
 * revoked — and this app signs trades, so "log out everywhere" has to mean
 * something. An opaque random id in an httpOnly cookie, checked against a row,
 * is both simpler and the thing that can actually be invalidated.
 */

export const SESSION_COOKIE = "fobs_session";
const SESSION_DAYS = 30;

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  walletAddress: string | null;
  onboarded: boolean;
};

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { id, userId, expiresAt } });
  return id;
}

export async function destroySession(id: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id } });
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // `lax` rather than `strict`: the X OAuth callback arrives as a top-level
    // cross-site navigation, and `strict` would withhold the cookie on it.
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  };
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_DAYS * 86_400_000);
}

/**
 * Who is making this request.
 *
 * Returns null rather than throwing: several pages are readable signed-out, and
 * the few that are not decide for themselves what to do about it.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
          walletAddress: true,
          onboardedAt: true
        }
      }
    }
  });
  if (!session) return null;

  // Expiry is checked here rather than by trusting the cookie's own `expires`:
  // the cookie is a claim, the row is the fact.
  if (session.expiresAt.getTime() < Date.now()) {
    await destroySession(id);
    return null;
  }

  const { user } = session;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    walletAddress: user.walletAddress,
    onboarded: user.onboardedAt !== null
  };
}
