import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { currentUser } from "@/lib/server/session";
import { walletsFor } from "@/lib/server/wallets";
import { normalizeUsername, usernameError } from "@/lib/server/username";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Everything attached to the signed-in account.
 *
 * Reads the `Wallet` table rather than `User.walletAddress`, because the point
 * of this endpoint is to show *all* of them — the one the account trades from
 * and any others that have been linked. The mirrored column can only name one.
 *
 * There is no custodial key: FOBS holds no wallet for anyone, so every wallet a
 * response lists is one the user holds the key for themselves.
 */
export async function GET() {
  const viewer = await currentUser();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [wallets, identity] = await Promise.all([
    walletsFor(viewer.id),
    prisma.user.findUnique({
      where: { id: viewer.id },
      select: { xUserId: true, googleId: true, createdAt: true }
    })
  ]);

  return NextResponse.json({
    account: {
      username: viewer.username,
      displayName: viewer.displayName,
      // Whether, not which. The id itself is of no use to the client and is one
      // more place it could leak from.
      hasX: identity?.xUserId != null,
      hasGoogle: identity?.googleId != null,
      createdAt: identity?.createdAt.toISOString() ?? null
    },
    wallets: wallets.map((wallet) => ({
      address: wallet.address,
      source: wallet.source,
      isPrimary: wallet.isPrimary,
      label: wallet.label,
      createdAt: wallet.createdAt.toISOString()
    }))
  });
}

/**
 * Change the account's username.
 *
 * Providers seed a username on first sign-in (an X handle, an email's local
 * part), but that is a starting point, not a decision — this lets the account
 * owner pick their own. It is validated to the same slug rules as a derived one,
 * because it shows up in URLs, and its uniqueness is enforced both here and by
 * the column, so a race that slips past the check still cannot create a
 * duplicate.
 */
export async function PATCH(request: Request) {
  const viewer = await currentUser();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { username?: unknown } | null;
  const raw = typeof body?.username === "string" ? body.username : "";
  const name = normalizeUsername(raw);

  const invalid = usernameError(name);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  if (name === viewer.username) {
    return NextResponse.json({ username: name });
  }

  const taken = await prisma.user.findFirst({
    where: { username: name, NOT: { id: viewer.id } },
    select: { id: true }
  });
  if (taken) {
    return NextResponse.json(
      { error: "That username is taken.", code: "username_taken" },
      { status: 409 }
    );
  }

  try {
    await prisma.user.update({ where: { id: viewer.id }, data: { username: name } });
  } catch (error) {
    // A concurrent claim on the same name trips the unique column between the
    // check above and this write. Report it as the collision it is, not a 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "That username was just taken.", code: "username_taken" },
        { status: 409 }
      );
    }
    throw error;
  }

  return NextResponse.json({ username: name });
}
