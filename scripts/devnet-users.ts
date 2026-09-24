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
 * Ten users, each with a keypair cached at `.devnet/users/<username>.json`.
 * These are the ten the activity loop trades as, and the ten every new account
 * starts out following (`lib/server/default-friends.ts`), which is what makes
 * the feed and the notification bell live on a fresh signup:
 *
 *   grey      the account you sign in as
 *   alice     the person you follow
 *   bob       FOMOs Alice's trade
 *   charlie   the wider room, so "For You" differs from "Following"
 *   …and six more, so the room has enough people in it that the feed is
 *   continuously moving rather than obviously taking turns.
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

/**
 * Enough for many transactions, sized to what the faucet actually allows.
 *
 * The cost per trade is not the fee, it is rent: `trade` creates the receipt
 * with `init` and the trader as payer, and nothing ever closes it — the receipt
 * *is* the product. A 139-byte `TradeReceipt` is 267 × 6960 = ~1.86M lamports,
 * so every trade permanently costs its trader that much, plus the 5k fee. (The
 * 89-byte `Holding` is 0.0015 SOL, but only on the first trade in each asset.)
 *
 * At the activity loop's one trade per 45s across ten accounts, a trader spends
 * roughly 0.015 SOL/hour, so 0.35 SOL is about a day of continuous activity.
 *
 * The ceiling is the faucet, not the program: `solana airdrop` is capped per IP
 * per day, and ten users at 0.5 SOL needed 5.0 against a ~2.5 SOL daily
 * allowance. Ten at 0.35 fits a 4 SOL admin with the reserve intact. Raise it
 * with `FOBS_SOL_PER_USER` when there is more to spend.
 *
 * Keep this in step with `apps/web/lib/server/funding.ts`, which funds
 * onboarding wallets to the same target.
 */
const SOL_PER_USER = Number(process.env.FOBS_SOL_PER_USER ?? 0.35);
/** Buying power for the demo. Selling needs no USDC, so this only has to cover buys. */
const USDC_PER_USER = 25_000n * 10n ** 6n;
const DECIMALS = 6;

/**
 * Keep this much SOL back for the operator.
 *
 * Every trade the activity loop makes is signed by one of these accounts, and
 * each needs a fee plus ATA rent. A user topped up to exactly `SOL_PER_USER`
 * with nothing left over is a user that stops trading first and looks, from the
 * feed, exactly like one that was never set up.
 */
const ADMIN_RESERVE_SOL = 0.5;

const USERS = [
  { username: "grey", displayName: "Grey" },
  { username: "alice", displayName: "Alice Chen" },
  { username: "bob", displayName: "Bob Nakamura" },
  { username: "charlie", displayName: "Charlie Adeyemi" },
  { username: "dana", displayName: "Dana Whitfield" },
  { username: "emeka", displayName: "Emeka Okafor" },
  { username: "farah", displayName: "Farah Haddad" },
  { username: "gustavo", displayName: "Gustavo Reyes" },
  { username: "hana", displayName: "Hana Kobayashi" },
  { username: "ivan", displayName: "Ivan Petrov" }
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

  // --- Can the admin afford this run? --------------------------------------
  //
  // Checked up front, before a single keypair is written or a single transfer
  // is sent. Ten users at 0.5 SOL is 5.0 SOL, and the admin does not always
  // have it — so the failure mode this avoids is the bad one: running out
  // halfway, leaving some users funded and some not, and leaving a half-funded
  // user behind that is indistinguishable from a broken trade path. Better to
  // refuse the whole run and say exactly how much is missing.
  const adminBalance = await withRetry("admin balance", () =>
    connection.getBalance(admin.publicKey)
  );
  const adminSol = adminBalance / LAMPORTS_PER_SOL;
  const perUser = Math.round(SOL_PER_USER * LAMPORTS_PER_SOL);

  // Existing keypairs are already funded; only count what is actually missing.
  let required = 0;
  for (const { username } of USERS) {
    const keypair = loadKeypair(join(keyDir, `${username}.json`));
    if (!keypair) {
      required += perUser;
      continue;
    }
    const balance = await withRetry(`${username} balance`, () =>
      connection.getBalance(keypair.publicKey)
    );
    required += Math.max(0, perUser - balance);
  }

  const requiredSol = required / LAMPORTS_PER_SOL;
  const available = Math.max(0, adminSol - ADMIN_RESERVE_SOL);
  console.log(
    `funding  ${requiredSol.toFixed(3)} SOL needed, ` +
      `${available.toFixed(3)} SOL spendable (${adminSol.toFixed(3)} held, ` +
      `${ADMIN_RESERVE_SOL} reserved)\n`
  );

  if (requiredSol > available) {
    const short = requiredSol - available;
    throw new Error(
      `Admin wallet is short ${short.toFixed(3)} SOL.\n\n` +
        `  needed      ${requiredSol.toFixed(3)} SOL for ${USERS.length} users\n` +
        `  spendable   ${available.toFixed(3)} SOL\n` +
        `  admin       ${admin.publicKey.toBase58()}\n\n` +
        `Top it up and re-run:\n` +
        `  solana airdrop 2 ${admin.publicKey.toBase58()} --url devnet\n\n` +
        `Refusing to fund some users and not others — a half-funded user cannot\n` +
        `be told apart from a broken trade path, which is the whole reason this\n` +
        `check runs before anything is written.`
    );
  }

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
    if (balance < perUser / 2) {
      const topUp = perUser - balance;
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
