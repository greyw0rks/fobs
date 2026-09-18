/**
 * Onboarding acceptance test: does a brand-new user get a real, funded wallet?
 *
 * `smoke:loop` proves the trading loop between seeded accounts. This proves the
 * step before it — that someone who arrives through X ends up able to trade at
 * all — and proves it the only way that counts: by reading the wallet's balance
 * back *off devnet*, not by checking that a row was written.
 *
 * Run: pnpm smoke:onboard
 *
 * Re-runnable by design, and it leaves the scratch account behind on purpose.
 * It cannot delete it: once the scratch user has traded, there is a receipt on
 * chain and a `Trade` row pointing at them, and deleting the row would leave the
 * indexer erroring on an owner it can no longer resolve — forever, since the
 * receipt is not going away. So each run resets the *wallet* and re-onboards,
 * which is the part under test anyway. The trades accumulate in the dev feed as
 * they would for anyone.
 */
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { prisma } from "../lib/prisma";
import { connection, usdcMint } from "../lib/solana/config";
import { custodyConfigured, openSecret } from "../lib/server/custody";
import { NoWalletError, ensureWallet, signerForUser } from "../lib/server/onboarding";
import { executeTradeAsTestUser } from "../lib/server/execute-trade";

const USERNAME = "onboard-check";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`[${ok ? "  ok  " : " FAIL "}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run against a production deployment.");
  }
  if (!custodyConfigured()) {
    throw new Error(
      "FOBS_CUSTODY_KEY is not set. Onboarding cannot run without it — which is the point."
    );
  }

  // --- a scratch user in the state X leaves them in -------------------------
  const existing = await prisma.user.findUnique({ where: { username: USERNAME } });
  const created = existing === null;
  const user =
    existing ??
    (await prisma.user.create({
      data: { username: USERNAME, displayName: "Onboard Check" }
    }));

  // Reset back to "authenticated, no wallet yet". The previous run's keypair is
  // about to be replaced; its SOL and USDC stay on devnet, unspent and unclaimed,
  // which is the honest cost of running this twice.
  await prisma.user.update({
    where: { id: user.id },
    data: { walletAddress: null, walletSecret: null, onboardedAt: null }
  });
  console.log(`@${USERNAME}: ${created ? "created" : "reused"}, reset to no wallet\n`);

  // Re-read rather than inspecting the pre-reset row, so the assertion is about
  // the state onboarding actually starts from.
  const fresh = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { walletAddress: true, walletSecret: true, onboardedAt: true }
  });
  check("a new user has no wallet", fresh.walletAddress === null && fresh.walletSecret === null);
  check("a new user is not onboarded", fresh.onboardedAt === null);

  // A user with no wallet must not be able to sign — the check that makes the
  // rest of this meaningful.
  const refused = await signerForUser({
    id: user.id,
    username: USERNAME,
    isTestUser: false,
    walletAddress: null,
    walletSecret: null
  }).then(
    () => null,
    (error: unknown) => error
  );
  check("a user with no wallet cannot sign", refused instanceof NoWalletError);

  // --- onboard --------------------------------------------------------------
  const result = await ensureWallet(user.id);
  console.log(
    `\nwallet ${result.address}\n  +${result.sol} SOL  +${result.usdc} USDC` +
      (result.problems.length ? `\n  problems: ${result.problems.join("; ")}` : "")
  );

  check("onboarding produced an address", result.address.length > 30);
  check("the result says the wallet was created", result.created);
  check("there were no funding problems", result.problems.length === 0, result.problems.join("; "));

  // --- the wallet is real, on chain -----------------------------------------
  const address = new PublicKey(result.address);
  const lamports = await connection().getBalance(address);
  check(
    "the wallet holds devnet SOL",
    lamports > 0,
    `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`
  );

  const ata = getAssociatedTokenAddressSync(usdcMint(), address);
  const usdc = await connection()
    .getTokenAccountBalance(ata)
    .then((r) => Number(r.value.uiAmount ?? 0))
    .catch(() => 0);
  check("the wallet holds test USDC", usdc > 0, `${usdc} USDC`);

  // --- the secret is stored sealed, not in the clear ------------------------
  const stored = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { walletAddress: true, walletSecret: true, onboardedAt: true }
  });
  check("the address was persisted", stored.walletAddress === result.address);
  check("onboardedAt was set", stored.onboardedAt !== null);
  check(
    "the stored secret is not the raw keypair",
    stored.walletSecret !== null && !stored.walletSecret.startsWith("[")
  );

  // The decisive check: the sealed blob opens back to the key that controls the
  // address the database names. If these disagree, every trade would fail
  // preflight with a signature error that reads like a program bug.
  const opened = Keypair.fromSecretKey(openSecret(stored.walletSecret!));
  check(
    "the sealed secret opens to the wallet's own keypair",
    opened.publicKey.toBase58() === result.address
  );

  const signer = await signerForUser({
    id: user.id,
    username: USERNAME,
    isTestUser: false,
    walletAddress: stored.walletAddress,
    walletSecret: stored.walletSecret
  });
  check("signerForUser resolves a non-test user", signer.publicKey.toBase58() === result.address);

  // --- and the point of all of it: they can trade ---------------------------
  console.log("\ntrading as the onboarded user…");
  const trade = await executeTradeAsTestUser({
    username: USERNAME,
    symbol: "sAAPL",
    side: "buy",
    amountUsdc: 25
  });
  console.log(`   tx ${trade.signature}`);
  check("the onboarded user's trade settled on chain", trade.signature.length > 30);

  const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.tradeId } });
  check("the trade is attributed to them", row.userId === user.id, `${row.amountUsdc} USDC`);

  // --- re-running does not make a second wallet ----------------------------
  const again = await ensureWallet(user.id);
  check("onboarding is idempotent", again.address === result.address && !again.created);

  console.log(
    failures === 0
      ? "\nall checks passed — an X user gets a real, funded, tradable devnet wallet"
      : `\n${failures} check(s) failed`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
