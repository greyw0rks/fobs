import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";

/**
 * Sign in with a Solana wallet.
 *
 * The user connects Phantom, Solflare, Backpack, anything that can
 * `signMessage`, and this module is what turns that into a FOBS identity.
 *
 * The shape is a challenge-response, and the reason it is a *stored* challenge
 * rather than a signed token is the same reason `Session` is a row: the server
 * has to be able to say "this exact prompt was issued, by us, for this address,
 * once". A session is created by proving control of an address, and nothing here
 * proves anything except through a signature over bytes we chose.
 *
 * Two properties the design turns on:
 *
 *   1. **The message is stored, not rebuilt.** A verifier that reconstructs the
 *      prompt has to reproduce it byte for byte — a different date format, an
 *      extra newline, a host that resolved differently — and any drift shows up
 *      as "invalid signature", which points at the key rather than at the
 *      message. Storing the exact bytes removes that failure mode entirely, and
 *      costs one column.
 *
 *   2. **A nonce is single-use and time-boxed.** Redeeming marks it used rather
 *      than deleting it, so a replayed challenge is *distinguishable* from an
 *      invented one. That distinction is what makes a support question
 *      answerable.
 *
 * What this deliberately does not do is hold the key. An account that arrives
 * this way has no server-held key — every trade it makes is signed in the
 * browser. See `wallets.ts`.
 */

/** Five minutes: long enough to connect a wallet and approve, short enough to matter. */
const NONCE_TTL_MS = 5 * 60_000;

/** Marks "the challenge cannot be redeemed", with the reason stated. */
export class WalletChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletChallengeError";
  }
}

export type NoncePurpose = "sign-in" | "link";

/**
 * The prompt a wallet is asked to sign.
 *
 * Follows the Sign In With Solana layout closely enough to look familiar in a
 * wallet's approval dialog, and states the domain plainly, because that line is
 * the only thing standing between a user and approving this on a phishing site.
 * The human-readable statement is not decoration — it is the part a person
 * actually reads before pressing approve.
 */
function buildMessage(input: {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: Date;
  purpose: NoncePurpose;
}): string {
  const statement =
    input.purpose === "link"
      ? "Link this wallet to your existing FOBS account."
      : "Sign in to FOBS. This signature proves you control this wallet. It does not authorise any transaction.";

  return [
    `${input.domain} wants you to sign in with your Solana account:`,
    input.address,
    "",
    statement,
    "",
    `URI: ${input.domain}`,
    "Version: 1",
    `Chain ID: solana:mainnet`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`
  ].join("\n");
}

/**
 * Issue a challenge for an address.
 *
 * `address` is validated as a real on-curve-encoded public key here rather than
 * in the route, so every caller gets the same answer about what a wallet address
 * is — and a malformed one fails at issue time, not at verify time where it
 * would look like a signature problem.
 */
export async function issueChallenge(input: {
  address: string;
  purpose: NoncePurpose;
  userId?: string | null;
  domain: string;
}): Promise<{ nonce: string; message: string; expiresAt: Date }> {
  const address = normaliseAddress(input.address);
  const nonce = randomBytes(24).toString("base64url");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);

  const message = buildMessage({
    domain: input.domain,
    address,
    nonce,
    issuedAt,
    purpose: input.purpose
  });

  await prisma.authNonce.create({
    data: {
      nonce,
      message,
      address,
      purpose: input.purpose,
      userId: input.userId ?? null,
      expiresAt
    }
  });

  return { nonce, message, expiresAt };
}

export type RedeemedChallenge = {
  address: string;
  purpose: NoncePurpose;
  userId: string | null;
};

/**
 * Check a signature against the challenge it claims to answer.
 *
 * Order matters: the challenge is looked up and validated *before* the signature
 * is examined, so an expired or already-spent nonce is refused without spending
 * a curve operation on it — and, more importantly, so the reason a caller is
 * refused is always the true one.
 *
 * The nonce is marked used only after the signature verifies. Marking first
 * would let an attacker burn a legitimate user's challenge with a junk
 * signature, turning a failed login into a denial of one.
 */
export async function redeemChallenge(input: {
  nonce: string;
  address: string;
  signature: string;
}): Promise<RedeemedChallenge> {
  const row = await prisma.authNonce.findUnique({ where: { nonce: input.nonce } });
  if (!row) throw new WalletChallengeError("That sign-in challenge was not issued here.");

  if (row.usedAt) {
    throw new WalletChallengeError(
      "That sign-in challenge has already been used. Request a new one."
    );
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new WalletChallengeError("That sign-in challenge expired. Request a new one.");
  }

  const address = normaliseAddress(input.address);
  if (row.address && row.address !== address) {
    throw new WalletChallengeError(
      "That challenge was issued for a different wallet address. Request a new one."
    );
  }

  // The signature is over the stored bytes, by the key that claims to have
  // signed. `nacl.sign.detached.verify` is what a Solana wallet's
  // `signMessage` produces: an ed25519 detached signature, base64 in transit.
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = Uint8Array.from(Buffer.from(input.signature, "base64"));
  } catch {
    throw new WalletChallengeError("The signature was not valid base64.");
  }
  if (signatureBytes.length !== 64) {
    throw new WalletChallengeError(
      `A Solana signature is 64 bytes; this one is ${signatureBytes.length}.`
    );
  }

  const messageBytes = new TextEncoder().encode(row.message);
  const publicKeyBytes = new PublicKey(address).toBytes();

  if (!nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)) {
    throw new WalletChallengeError(
      "That signature does not match the wallet address. Check you approved the " +
        "message in the wallet you connected."
    );
  }

  // Verified — now, and only now, spend it. The conditional update makes the
  // window between the read above and this write harmless: a second concurrent
  // redemption updates zero rows and is refused.
  const spent = await prisma.authNonce.updateMany({
    where: { nonce: row.nonce, usedAt: null },
    data: { usedAt: new Date() }
  });
  if (spent.count === 0) {
    throw new WalletChallengeError(
      "That sign-in challenge has already been used. Request a new one."
    );
  }

  return {
    address,
    purpose: row.purpose === "link" ? "link" : "sign-in",
    userId: row.userId
  };
}

/**
 * A base58 Solana address, or a thrown reason it is not one.
 *
 * `new PublicKey` accepts a 32-byte value that is not a valid ed25519 point, so
 * a structurally-valid-but-unusable address would sail through and fail much
 * later at signature verification. Checking the decoded length here keeps the
 * error where the cause is.
 */
export function normaliseAddress(input: string): string {
  const trimmed = input.trim();
  let key: PublicKey;
  try {
    key = new PublicKey(trimmed);
  } catch {
    throw new WalletChallengeError(`"${trimmed}" is not a Solana address.`);
  }
  if (key.toBytes().length !== 32) {
    throw new WalletChallengeError("A Solana address is 32 bytes.");
  }
  return key.toBase58();
}

/**
 * A username for an account created by wallet sign-in.
 *
 * Derived from the address rather than asked for, so connecting a wallet is a
 * single approval with no form to fill in. `availableUsername` in the X callback
 * is the same problem solved the same way; this one is short and legible because
 * a base58 address is neither.
 */
export function usernameForAddress(address: string): string {
  return `sol-${address.slice(0, 4).toLowerCase()}${address.slice(-2).toLowerCase()}`;
}

/** A display name that is not a raw address and is not a lie about who they are. */
export function displayNameForAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
