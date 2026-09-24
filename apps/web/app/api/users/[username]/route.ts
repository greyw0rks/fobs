import { NextResponse } from "next/server";
import { getProfile } from "@/lib/server/queries";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const viewer = await currentUser();
  const profile = await getProfile(username, viewer?.id ?? null);
  if (!profile) {
    return NextResponse.json({ error: "No such user" }, { status: 404 });
  }
  return NextResponse.json({ profile });
}
