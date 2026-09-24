import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { prisma } from "@/lib/prisma";
import { sanitizeBio, sanitizeProfileLinks } from "@/lib/profile-links";

export const dynamic = "force-dynamic";

/**
 * Edit the parts of a profile the owner writes for themselves: a short bio and a
 * handful of external links. Kept separate from `PATCH /api/me/account` (which
 * owns the username) so the slug rules and the free-text rules do not tangle.
 *
 * Both fields are validated in `lib/profile-links.ts` before they are written —
 * the `links` column is text, not a typed column, so the app is the only thing
 * enforcing the shape. A link is only accepted if its URL is an absolute http(s)
 * URL, which is what stops a stored value ever becoming a `javascript:` href.
 */
export async function PATCH(request: Request) {
  const viewer = await currentUser();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { bio?: unknown; links?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const bioResult = sanitizeBio(body.bio);
  if ("error" in bioResult) return NextResponse.json({ error: bioResult.error }, { status: 400 });

  const linksResult = sanitizeProfileLinks(body.links);
  if ("error" in linksResult) {
    return NextResponse.json({ error: linksResult.error }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: viewer.id },
    data: {
      bio: bioResult.bio,
      // Stored as a JSON string; an empty list is persisted as null so an empty
      // profile reads the same whether it was never set or later cleared.
      links: linksResult.links.length > 0 ? JSON.stringify(linksResult.links) : null
    }
  });

  return NextResponse.json({ bio: bioResult.bio, links: linksResult.links });
}
