import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Custody of user signing keys.
 *
 * This module exists because of one deliberate choice: this is a devnet test
 * environment where a real user signs in with X and then trades, so *something*
 * has to hold their key. Holding it in the browser would need a wallet adapter
 * and a signing round trip; holding it here is the smaller build and the reason
 * every account can complete the trading loop on arrival.
 *
 * That choice has a cost, and the cost is this file. The server can sign as any
 * user. On devnet, where nothing is worth anything, that is acceptable. It is
 * not acceptable for a product holding real value, and the honest thing is to
 * say so here rather than in a footnote.
 *
 * What this module does and does not do:
 *
 *   - Seals each key with AES-256-GCM under a key from `FOBS_CUSTODY_KEY`, so a
 *     database dump is not also a set of signing keys. GCM rather than CBC
 *     because it authenticates: a tampered ciphertext fails to open rather than
 *     decrypting to a different, valid-looking keypair.
 *   - Refuses to operate at all when `FOBS_CUSTODY_KEY` is unset, rather than
 *     inventing a key or falling back to plaintext. An unconfigured deployment
 *     creates no wallets; it does not create insecure ones.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/**
 * The sealing key, or null when custody is not configured.
 *
 * A 32-byte key, base64. Generated with `openssl rand -base64 32`.
 */
function custodyKey(): Buffer | null {
  const raw = process.env.FOBS_CUSTODY_KEY;
  if (!raw) return null;

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `FOBS_CUSTODY_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        "Generate one with `openssl rand -base64 32`."
    );
  }
  return key;
}

export function custodyConfigured(): boolean {
  return Boolean(process.env.FOBS_CUSTODY_KEY);
}

/** Marks "no sealing key on this deployment", which is a configuration state, not a bug. */
export class CustodyUnconfiguredError extends Error {
  constructor() {
    super(
      "FOBS_CUSTODY_KEY is not set, so this deployment cannot hold user wallets. " +
        "Set it (openssl rand -base64 32) to enable onboarding."
    );
    this.name = "CustodyUnconfiguredError";
  }
}

/**
 * `iv.tag.ciphertext`, base64. The IV is random per seal and stored alongside —
 * reusing an IV under the same key would break GCM badly, so it is never
 * derived from the plaintext or the user.
 */
export function sealSecret(secret: Uint8Array): string {
  const key = custodyKey();
  if (!key) throw new CustodyUnconfiguredError();

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64")).join(".");
}

export function openSecret(sealed: string): Uint8Array {
  const key = custodyKey();
  if (!key) throw new CustodyUnconfiguredError();

  const parts = sealed.split(".");
  if (parts.length !== 3) {
    throw new Error("Sealed key is malformed; refusing to guess at its layout.");
  }
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  } catch {
    // GCM authentication failed: either the wrong FOBS_CUSTODY_KEY is in play or
    // the ciphertext was altered. Both mean "this key is not ours to use", and
    // neither should be papered over with a retry.
    throw new Error(
      "Could not open a sealed wallet key. The FOBS_CUSTODY_KEY does not match the " +
        "one this key was sealed with, or the stored value was modified."
    );
  }
}
