import { prisma } from "@/lib/prisma";

/**
 * Which addresses belong to whom.
 *
 * This module exists because the link between a Solana address and a FOBS user
 * was previously a single column — `User.walletAddress` — and one column can
 * only name one wallet. That was fine while every wallet was minted by the
 * server and there was exactly one per person. It stops being fine the moment
 * somebody connects the Phantom wallet they already have, or links a second one,
 * or arrives by signing a message with a wallet we have never seen:
 *
 *   - the **indexer** has to attribute a receipt to the user who signed it, and
 *     a trade from a linked wallet must land in that user's feed, not vanish as
 *     an address nobody recognises;
 *   - the **trade path** has to know whether it may sign for a user at all, and
 *     the honest answer for an external wallet is no;
 *   - **linking** has to detect that an address is already spoken for, which is
 *     a real case and not an error to swallow.
 *
 * `User.walletAddress` is kept, because it is read on nearly every request and a
 * join to answer "what is this person's address" would be noise. It mirrors the
 * `isPrimary` wallet and `wallets.ts` is the only thing that writes it.
 */

export class WalletTakenError extends Error {
  constructor(address: string) {
    super(
      `${address.slice(0, 4)}…${address.slice(-4)} is already linked to another account.`
    );
    this.name = "WalletTakenError";
  }
}

/**
 * The user who owns an address, or null.
 *
 * Reads `Wallet` first — the complete set — and falls back to
 * `User.walletAddress`, because a row written before this table existed is still
 * a true statement about who owns an address, and the backfill is not guaranteed
 * to have run.
 */
export async function resolveUserByAddress(address: string) {
  const wallet = await prisma.wallet.findUnique({
    where: { address },
    select: {
      user: {
        select: { id: true, username: true, displayName: true }
      }
    }
  });
  if (wallet) return wallet.user;

  return prisma.user.findUnique({
    where: { walletAddress: address },
    select: { id: true, username: true, displayName: true }
  });
}

/** Every user who trades from this address. At most one, by construction. */
export async function userForAddress(address: string) {
  return resolveUserByAddress(address);
}

/**
 * Record an address as belonging to a user, once.
 *
 * Idempotent on the address: re-registering the same pair is a no-op rather than
 * an error, so this is safe to call on every sign-in. Throws
 * `WalletTakenError` when the address already belongs to *someone else* — that
 * is the case worth failing on, because silently reassigning it would move one
 * person's trade history to another.
 *
 * `isPrimary` defaults to false. Callers set it explicitly; `setPrimaryWallet`
 * is what keeps `User.walletAddress` in step.
 */
export async function recordWallet(input: {
  userId: string;
  address: string;
  source: "custody" | "external";
  label?: string | null;
  isPrimary?: boolean;
}): Promise<void> {
  const { userId, address, source, label = null, isPrimary = false } = input;

  const existing = await prisma.wallet.findUnique({
    where: { address },
    select: { id: true, userId: true }
  });

  if (existing && existing.userId !== userId) throw new WalletTakenError(address);

  if (existing) {
    await prisma.wallet.update({
      where: { id: existing.id },
      data: { label: label ?? undefined }
    });
  } else {
    await prisma.wallet.create({ data: { userId, address, source, label, isPrimary } });
  }

  if (isPrimary) await setPrimaryWallet(userId, address);
}

/**
 * Make an address the user's primary wallet.
 *
 * Writes both sides in one transaction: the `isPrimary` flags on `Wallet` and
 * the mirrored `User.walletAddress`. They are two representations of one fact,
 * and a half-applied change would leave the UI naming one wallet while the
 * indexer resolved another.
 */
export async function setPrimaryWallet(userId: string, address: string): Promise<void> {
  await prisma.$transaction([
    prisma.wallet.updateMany({
      where: { userId, isPrimary: true, address: { not: address } },
      data: { isPrimary: false }
    }),
    prisma.wallet.updateMany({
      where: { userId, address },
      data: { isPrimary: true }
    }),
    prisma.user.update({ where: { id: userId }, data: { walletAddress: address } })
  ]);
}

/**
 * Write a `Wallet` row for every user whose address predates the table.
 *
 * Any account onboarded before this module existed has an address and no row.
 * Without this, the indexer would fall back to `User.walletAddress` and keep
 * working — but linking a second wallet would then leave the first invisible to
 * everything that reads `Wallet`.
 *
 * Every address that arrives this way is a wallet the user holds the key for, so
 * it is `external` by definition.
 */
export async function backfillWallets(): Promise<{ created: number; skipped: number }> {
  const users = await prisma.user.findMany({
    where: { walletAddress: { not: null } },
    select: { id: true, username: true, walletAddress: true }
  });

  let created = 0;
  let skipped = 0;

  for (const user of users) {
    if (!user.walletAddress) continue;
    const existing = await prisma.wallet.findUnique({
      where: { address: user.walletAddress },
      select: { id: true }
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.wallet.create({
      data: {
        userId: user.id,
        address: user.walletAddress,
        source: "external",
        isPrimary: true
      }
    });
    created++;
  }

  return { created, skipped };
}

/** The user's primary address, from the table if it is there and the column if not. */
export async function primaryAddress(userId: string): Promise<string | null> {
  const wallet = await prisma.wallet.findFirst({
    where: { userId, isPrimary: true },
    select: { address: true }
  });
  if (wallet) return wallet.address;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletAddress: true }
  });
  return user?.walletAddress ?? null;
}

/** Every address this user can trade from — used by the trade path and the UI. */
export async function walletsFor(userId: string) {
  return prisma.wallet.findMany({
    where: { userId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true, address: true, source: true, isPrimary: true, label: true, createdAt: true }
  });
}
