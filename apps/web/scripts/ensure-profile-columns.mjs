// scripts/ensure-profile-columns.mjs
//
// Additive, idempotent migration for the profile bio/links feature.
//
// This project is db-push driven (no prisma/migrations directory), and the live
// Neon schema is being reshaped by the mainnet-bridge pivot in parallel — so a
// full `prisma db push` here is unsafe (it would apply every in-flight schema
// difference, including drops). Instead this adds ONLY the two new nullable
// columns the `User.bio` / `User.links` feature needs, with IF NOT EXISTS so it
// is a no-op once applied and safe to run on every build.
//
// It runs in the Vercel build (which has DATABASE_URL in its environment) rather
// than locally, so no database credential is ever materialized on a workstation.

import { PrismaClient } from "@prisma/client";

// Only run against Postgres (the Neon prod/preview database). A local build with
// no DATABASE_URL, or one pointed at the sqlite dev schema, skips this entirely:
// the `ADD COLUMN IF NOT EXISTS` syntax is Postgres-specific, and local dev keeps
// its schema through `prisma db push` against dev.db.
const url = process.env.DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.log("[ensure-profile-columns] no Postgres DATABASE_URL — skipping.");
  process.exit(0);
}

const prisma = new PrismaClient();

try {
  await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bio" TEXT;');
  await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "links" TEXT;');
  console.log("[ensure-profile-columns] User.bio / User.links present.");
} catch (error) {
  console.error("[ensure-profile-columns] failed:", error);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
