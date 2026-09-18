import { Keypair } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";
import { CustodyUnconfiguredError, custodyConfigured, openSecret, sealSecret } from "./custody";
import { fundWallet } from "./funding";
import { NotATestUserError, signingKeyFor } from "./test-users";

/**
 * Wallet onboarding.
 *
 * The step between "X says you are who you say you are" and "you can trade".
 * A user exists from the moment X identifies them; a wallet appears here.
 *
 * Two sources of key material meet in this module and nowhere else:
 *
 *   - a seeded test account, whose key is a file the scripts wrote, and
 *   - everyone else, whose key is generated here and sealed into the database.
 *
 * `signerForUser` is the single entry point for both, so no caller has to know
 * which kind of user it is holding. That matters: the trade path calling the
 * wrong one is exactly how a real user would end up signing with a seeded key.
 */

/** The columns that decide how a user signs. */
export type SignableUser = {
  id: string;
  username: string;
  isTestUser: boolean;
  walletAddress: string | null;
  walletSecret: string | null;
};

/** Marks "this user has no wallet yet", which onboarding can fix. */
export class NoWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoWalletError";
  }
}

/** Marks a row that names a wallet this deployment holds no key for. */
export class NoKeyForWalletError extends Error {
  constructor(username: string) {
    super(
      `@${username} has a wallet address but no key stored for it, so this deployment ` +
        "cannot sign as them. This should not happen for an onboarded user."
    );
    this.name = "NoKeyForWalletError";
  }
}

/**
 * The keypair a user signs with, or a thrown reason why they cannot sign.
 *
 * Test users are checked first and by flag, never by name — a username is a
 * display name and could in principle be held by someone else, so reaching a
 * seeded keypair requires the flag the seeder wrote.
 */
export async function signerForUser(user: SignableUser): Promise<Keypair> {
  if (user.isTestUser) {
    const key = signingKeyFor(user);
    if (!key) throw new NotATestUserError(user.username);
    return key;
  }

  if (!user.walletAddress) {
    throw new NoWalletError(`@${user.username} has no wallet yet. Finish onboarding first.`);
  }
  if (!user.walletSecret) throw new NoKeyForWalletError(user.username);
  return Keypair.fromSecretKey(openSecret(user.walletSecret));
}

export type OnboardResult = {
  address: string;
  /** False when the user already had a wallet — the common case on every sign-in but the first. */
  created: boolean;
  sol: number;
  usdc: number;
  /** Non-empty when the wallet exists but could not be fully funded. */
  problems: string[];
};

/**
 * Give a user a funded devnet wallet, once.
 *
 * Idempotent, and safe to call on every sign-in: a user who already has a wallet
 * gets a balance top-up check and nothing else. Called from the X callback *and*
 * from the trade path, because the callback's attempt can fail on a devnet
 * hiccup and a sign-in must not fail with it — the next trade retries.
 *
 * The keypair is generated first and funded second. That order matters: if
 * funding fails, the user keeps a real wallet whose address is recorded, and the
 * retry tops it up rather than generating a second wallet and stranding the
 * first.
 */
export async function ensureWallet(userId: string): Promise<OnboardResult> {
  if (!custodyConfigured()) throw new CustodyUnconfiguredError();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, username: true, walletAddress: true, walletSecret: true }
  });

  let keypair: Keypair;
  let created = false;

  if (user.walletAddress && user.walletSecret) {
    keypair = Keypair.fromSecretKey(openSecret(user.walletSecret));
  } else {
    keypair = Keypair.generate();
    created = true;
    // Sealed before it is stored, and stored before it is funded: the address
    // and the key that controls it are written together or not at all, so there
    // is no window where the database names a wallet nobody can sign for.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        walletAddress: keypair.publicKey.toBase58(),
        walletSecret: sealSecret(keypair.secretKey),
        onboardedAt: new Date()
      }
    });
  }

  const problems: string[] = [];
  let sol = 0;
  let usdc = 0;
  try {
    const funded = await fundWallet(keypair.publicKey);
    sol = funded.sol;
    usdc = funded.usdc;
    if (funded.skipped.includes("no admin keypair configured")) {
      problems.push(
        "No admin keypair on this deployment, so the wallet was created but not funded. " +
          "Set FOBS_ADMIN_KEYPAIR, or run `pnpm devnet:users` from the repo root."
      );
    }
  } catch (error) {
    // The wallet is real and usable as soon as it has SOL; a failed top-up is a
    // state to report, not a reason to discard the key we just made.
    problems.push(error instanceof Error ? error.message : String(error));
  }

  return { address: keypair.publicKey.toBase58(), created, sol, usdc, problems };
}

/** The columns that decide how a user signs. */
const SIGNABLE = {
  id: true,
  username: true,
  isTestUser: true,
  walletAddress: true,
  walletSecret: true
} as const;

/**
 * The signer for a username, onboarding the account first if it needs it.
 *
 * The seam the trade path uses. A user who authenticated through X may arrive
 * here with no wallet, and this creates one rather than refusing the trade —
 * this is the moment the wallet is needed, and sending someone to a separate
 * onboarding screen to press a button would be a step the product does not need.
 * For a seeded account it is a single read.
 */
export async function signerForUsername(username: string): Promise<Keypair> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { username },
    select: SIGNABLE
  });
  if (user.walletAddress || user.isTestUser) return signerForUser(user);

  await ensureWallet(user.id);
  // Re-read: the row above predates the wallet that was just created.
  return signerForUser(
    await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: SIGNABLE })
  );
}
