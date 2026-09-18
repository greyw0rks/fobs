import { Keypair } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { prisma } from "@/lib/prisma";
import { isProduction } from "./devnet-only";

/**
 * The test users' signing keys.
 *
 * These live on the server on purpose: the whole premise of the revision is that
 * the test environment is a small *real* social network, so Alice and Bob have
 * to be able to trade while you watch — which means something has to hold their
 * keys and sign for them. In a real product nothing would; here it is the
 * difference between a demo that trades and a demo that mimes trading.
 *
 * That makes this the single most dangerous module in the app, so it is
 * default-deny in production. See `./devnet-only`.
 */

/**
 * `.devnet/` sits at the repo root, but the app runs with cwd = `apps/web` while
 * scripts run with cwd = the root. Rather than guess which, walk up until the
 * directory is found.
 */
function devnetDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth++) {
    const candidate = join(dir, ".devnet");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not find .devnet/. Run `pnpm devnet:bootstrap && pnpm devnet:users` from the repo root."
  );
}

/** Marks the failure as "this was refused", not "this went wrong". */
export class TestSigningDisabledError extends Error {
  constructor() {
    super("Test-user signing is disabled in production.");
    this.name = "TestSigningDisabledError";
  }
}

/** Marks a request that tried to sign as a user who has no test keypair. */
export class NotATestUserError extends Error {
  constructor(username: string) {
    super(
      `@${username} is not a seeded test account, so there is no keypair to sign with.`
    );
    this.name = "NotATestUserError";
  }
}

/**
 * The keypair for a seeded test user.
 *
 * **The caller must have established that this user is a test user.** Key
 * material is addressed by *username* here, and a username is a display name —
 * something a user can hold, change hands, or claim on a fresh database. It is
 * not, and must never be treated as, an authorization credential. Hence
 * `signingKeyFor` below, which is the only way in from a request: it takes the
 * `isTestUser` flag as a required argument, so a caller cannot reach the keys
 * without having read that column.
 */
function signerFor(username: string): Keypair {
  if (isProduction()) throw new TestSigningDisabledError();

  const path = join(devnetDir(), "users", `${username}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `No keypair for test user ${username}. Run \`pnpm devnet:users\` from the repo root.`
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

/**
 * The keypair a user trades with, or null if they have none.
 *
 * `isTestUser` is a required parameter rather than something this function looks
 * up, deliberately: it makes the check impossible to skip by accident, and it
 * puts the flag in the signature where a reader will ask what it guards.
 */
export function signingKeyFor(user: {
  username: string;
  isTestUser: boolean;
}): Keypair | null {
  if (!user.isTestUser) return null;
  return signerFor(user.username);
}

/** The seeded test users, with the signer each one trades as. */
export async function testUsers() {
  if (isProduction()) throw new TestSigningDisabledError();
  const users = await prisma.user.findMany({
    where: { isTestUser: true },
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      displayName: true,
      walletAddress: true,
      _count: { select: { trades: true } }
    }
  });
  return users.map((user) => ({
    ...user,
    signer: user.walletAddress ? signerFor(user.username) : null
  }));
}

export async function testUserByUsername(username: string) {
  if (isProduction()) throw new TestSigningDisabledError();
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      isTestUser: true,
      displayName: true,
      walletAddress: true
    }
  });
  if (!user) return null;
  // A user with no wallet has nothing to sign with — a real state for someone
  // who authenticated through X and has not finished onboarding.
  if (!user.walletAddress) return { ...user, signer: null };
  return { ...user, signer: signingKeyFor(user) };
}
