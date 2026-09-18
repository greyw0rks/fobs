import { PrismaClient } from "@prisma/client";

/**
 * One client per process.
 *
 * Next's dev server re-evaluates modules on every hot reload, so a module-level
 * `new PrismaClient()` leaks a connection pool per edit until Postgres refuses
 * new connections. Caching on `globalThis` survives the reload; the cast is the
 * only way to hang a property off the global in TypeScript.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG_QUERIES ? ["query", "warn", "error"] : ["warn", "error"]
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
