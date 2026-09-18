import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listNotifications, unreadNotificationCount } from "@/lib/server/queries";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await currentUser();
  if (!viewer) return NextResponse.json({ notifications: [], unread: 0 });

  const [notifications, unread] = await Promise.all([
    listNotifications(viewer.id),
    unreadNotificationCount(viewer.id)
  ]);
  return NextResponse.json({ notifications, unread });
}

/** Mark all read. Scoped to the caller — there is no id in the body to forge. */
export async function POST() {
  const viewer = await currentUser();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const result = await prisma.notification.updateMany({
    where: { userId: viewer.id, readAt: null },
    data: { readAt: new Date() }
  });
  return NextResponse.json({ marked: result.count });
}
