import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/server/session";
import { RULES, enforce } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Follow / unfollow.
 *
 * The follower is always the signed-in user — never a value from the request —
 * so there is no way to create a follow on someone else's behalf. Following
 * yourself is refused because it would put your own trades in your Following
 * feed and send you notifications about yourself.
 */
async function resolve(request: Request, username: string) {
  const viewer = await currentUser();
  if (!viewer) {
    return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  // Charged before the lookups below, so a loop of follow/unfollow cannot use
  // this route as a free user-enumeration oracle either.
  const limited = enforce(request, viewer.id, RULES.follow);
  if (limited) return { error: limited };

  const target = await prisma.user.findUnique({
    where: { username: username.replace(/^@/, "") },
    select: { id: true }
  });
  if (!target) {
    return { error: NextResponse.json({ error: "No such user" }, { status: 404 }) };
  }
  if (target.id === viewer.id) {
    return {
      error: NextResponse.json({ error: "You cannot follow yourself" }, { status: 400 })
    };
  }
  return { viewer, target };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const resolved = await resolve(request, username);
  if ("error" in resolved) return resolved.error;

  const { viewer, target } = resolved;
  const key = { followerId: viewer.id, followingId: target.id };

  // Idempotent: following someone you already follow does nothing, including
  // sending a second notification. `Notification` has no relation to `Follow`
  // (a follow is not what a notification is *about* — the message is rendered
  // from the type and the actor), so the "was this new" question has to be asked
  // here rather than inferred from the write.
  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: key },
    // `Follow` has a composite primary key and no `id` column, so the existence
    // check selects a real field rather than a surrogate that does not exist.
    select: { followerId: true }
  });

  if (!existing) {
    await prisma.$transaction([
      prisma.follow.create({ data: key }),
      // The one notification in the set not driven by a trade.
      prisma.notification.create({
        data: { userId: target.id, type: "FOLLOW", actorUserId: viewer.id }
      })
    ]);
  }

  return NextResponse.json({ following: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const resolved = await resolve(request, username);
  if ("error" in resolved) return resolved.error;

  const { viewer, target } = resolved;
  // The follow is deleted; the FOLLOW notification it created is left alone.
  // Removing it would be rewriting what happened, and it is addressed to the
  // other person, not to us.
  await prisma.follow.deleteMany({
    where: { followerId: viewer.id, followingId: target.id }
  });

  return NextResponse.json({ following: false });
}
