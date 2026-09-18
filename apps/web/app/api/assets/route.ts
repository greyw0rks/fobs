import { NextResponse } from "next/server";
import { listAssets } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ assets: await listAssets() });
}
