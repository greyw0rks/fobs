/**
 * Create and fund the test users.
 *
 * The revision's premise is that the test environment is a small real social
 * network, not a fake feed with trading bolted on. So these are real keypairs
 * holding real devnet SOL and real test USDC, and every trade they make is a
 * real signed transaction. Nothing here is simulated.
 *
 * Run: pnpm devnet:users
 *
 * Four users, each with a keypair cached at `.devnet/users/<username>.json`:
 *
 *   grey      the account you sign in as
 *   alice     the person you follow
 *   bob       FOMOs Alice's trade
 *   charlie   the wider room, so "For You" differs from "Following"
 *
 * Funding comes from the admin wallet rather than `requestAirdrop`. Devnet
 * throttles airdrops hard enough that a four-user run routinely fails halfway,
 * and a half-funded user looks exactly like a broken trade path later on.
 *
 * Writes the wallet addresses into `.devnet/state.json` under `users`; the DB
 * seeder reads them from there, so this script never touches the database.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  mintTo
} from "@solana/spl-token";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sleep, withRetry } from "./lib/retry";

const root = process.cwd();
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

/** Enough for many transactions: each trade costs a fee plus ~2M lamports of ATA rent. */
const SOL_PER_USER = 0.5;
/** Buying power for the demo. Selling needs no USDC, so this only has to cover buys. */
const USDC_PER_USER = 25_000n * 10n ** 6n;
const DECIMALS = 6;

const USERS = [
  { username: "grey", displayName: "Grey" },
  { username: "alice", displayName: "Alice Chen" },
  { username: "bob", displayName: "Bob Nakamura" },
  { username: "charlie", displayName: "Charlie Adeyemi" }
] as const;

/** A user as recorded in `.devnet/state.json`. */
type SeededUser = { wallet: string; displayName?: string };

function loadKeypair(path: string): Keypair | null {
  if (!existsSync(path)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function saveKeypair(path: string, keypair: Keypair) {
  writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)));
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const admin = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync(
          process.env.ANCHOR_WALLET ?? join(homedir(), ".config", "solana", "id.json"),
          "utf8"
        )
      )
    )
  );

  const statePath = join(root, ".devnet", "state.json");
  if (!existsSync(statePath)) {
    throw new Error("Run `pnpm devnet:bootstrap` first — .devnet/state.json is missing.");
  }
  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    usdcMint: string;
    users?: Record<string, SeededUser>;
  };
  const usdcMint = new PublicKey(state.usdcMint);

  console.log(`cluster  ${RPC}`);
  console.log(`admin    ${admin.publicKey.toBase58()}`);
  console.log(`USDC     ${usdcMint.toBase58()}\n`);

  const keyDir = join(root, ".devnet", "users");
  mkdirSync(keyDir, { recursive: true });

  const users: Record<string, SeededUser> = { ...(state.users ?? {}) };

  for (const { username, displayName } of USERS) {
    const path = join(keyDir, `${username}.json`);
    let keypair = loadKeypair(path);
    const created = !keypair;
    if (!keypair) {
      keypair = Keypair.generate();
      saveKeypair(path, keypair);
    }
    const wallet = keypair.publicKey;
    console.log(`${username.padEnd(8)} ${wallet.toBase58()}${created ? " (new)" : ""}`);

    // --- SOL ---------------------------------------------------------------
    const balance = await withRetry(`${username} SOL balance`, () =>
      connection.getBalance(wallet)
    );
    const target = Math.round(SOL_PER_USER * LAMPORTS_PER_SOL);
    if (balance < target / 2) {
      const topUp = target - balance;
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: wallet,
          lamports: topUp
        })
      );
      await withRetry(`${username} SOL transfer`, async () => {
        const signature = await connection.sendTransaction(tx, [admin], {
          skipPreflight: true
        });
        await connection.confirmTransaction(signature, "confirmed");
      });
      console.log(`  +${(topUp / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
    } else {
      console.log(`  SOL ${(balance / LAMPORTS_PER_SOL).toFixed(3)} (sufficient)`);
    }

    // --- USDC --------------------------------------------------------------
    const ata = getAssociatedTokenAddressSync(usdcMint, wallet);
    const ataInfo = await withRetry(`${username} ATA`, () =>
      connection.getAccountInfo(ata)
    );
    if (!ataInfo) {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          admin.publicKey,
          ata,
          wallet,
          usdcMint
        )
      );
      await withRetry(`${username} create ATA`, async () => {
        const signature = await connection.sendTransaction(tx, [admin], {
          skipPreflight: true
        });
        await connection.confirmTransaction(signature, "confirmed");
      });
    }

    const usdcBalance = await withRetry(`${username} USDC balance`, () =>
      connection.getTokenAccountBalance(ata).then((r) => BigInt(r.value.amount))
    );
    if (usdcBalance < USDC_PER_USER) {
      await withRetry(`${username} mint USDC`, () =>
        mintTo(connection, admin, usdcMint, ata, admin, USDC_PER_USER)
      );
      console.log(`  +${Number(USDC_PER_USER) / 10 ** DECIMALS} test USDC`);
    } else {
      console.log(`  USDC ${Number(usdcBalance) / 10 ** DECIMALS} (sufficient)`);
    }

    users[username] = { wallet: wallet.toBase58(), displayName };

    // Devnet 429s on bursts; four transactions per user is already enough.
    await sleep(300);
  }

  writeFileSync(statePath, `${JSON.stringify({ ...state, users }, null, 2)}\n`);
  console.log(`\nwrote ${Object.keys(users).length} users to .devnet/state.json`);
  console.log("next: pnpm seed:db");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
