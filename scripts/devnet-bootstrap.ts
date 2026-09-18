/**
 * Bring a devnet deployment up to a tradable state, idempotently.
 *
 * Run: pnpm devnet:bootstrap
 *
 * Does five things, each skipped if already done:
 *
 *   1. reuse-or-create a 6-decimal test USDC mint and mint the admin a supply
 *   2. `initialize` the protocol
 *   3. `register_asset` for the five assets, in order (ids come from the
 *      protocol counter, so they must be registered sequentially)
 *   4. `set_mock_price` for each — devnet has no live Pyth equity feed, which is
 *      measured, not assumed: docs/PYTH_VERIFICATION.md
 *   5. `fund_vault` each reserve with real tokens
 *
 * Idempotency is not incidental. `initialize` and `register_asset` both `init`
 * and will hard-fail on a second run, while `fund_vault` simply *adds* — running
 * it twice silently doubles a reserve, which then makes the printed numbers
 * disagree with what the chain holds. So every step checks first.
 *
 * The mint keypair is cached at .devnet/usdc-mint.json: on devnet, "USDC" is
 * whatever mint we say it is, and reusing one address keeps wallets, ATAs and
 * explorer links stable across reruns.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo
} from "@solana/spl-token";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sleep, withRetry } from "./lib/retry";

// pnpm runs package scripts from the repo root, which is how the other scripts
// here resolve paths. (`import.meta.url` is not available: package.json has no
// "type": "module", so tsx compiles these as CommonJS.)
const root = process.cwd();

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const DECIMALS = 6;
const SPREAD_BPS = 50;

/** USD per share at 6 decimals. Mock — see docs/PYTH_VERIFICATION.md. */
const ASSETS = [
  { symbol: "sNVDA", price: 178.24 },
  { symbol: "sAAPL", price: 232.1 },
  { symbol: "sMSFT", price: 505.2 },
  { symbol: "sTSLA", price: 429.5 },
  { symbol: "sAMZN", price: 228.4 }
];

/** Per-vault reserve. Deep enough that a demo sell can always be paid out. */
const VAULT_FUNDING = 100_000n * 10n ** BigInt(DECIMALS);
const ADMIN_MINT_SUPPLY = 1_000_000n * 10n ** BigInt(DECIMALS);

const usd = (n: number) => BigInt(Math.round(n * 1_000_000));

const symbol = (s: string) => {
  const buf = Buffer.alloc(8);
  buf.write(s, "utf8");
  return Array.from(buf);
};

const u16le = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const walletPath =
    process.env.ANCHOR_WALLET ?? join(homedir(), ".config", "solana", "id.json");
  const admin = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")))
  );
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(admin),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync(join(root, "target", "idl", "fomo.json"), "utf8"));
  const program = new Program(idl as anchor.Idl, provider);

  console.log(`cluster   ${RPC}`);
  console.log(`admin     ${admin.publicKey.toBase58()}`);
  console.log(`program   ${program.programId.toBase58()}\n`);

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];

  const protocolPda = pda([Buffer.from("protocol")]);
  const assetPda = (id: number) => pda([Buffer.from("asset"), u16le(id)]);
  const vaultPda = (asset: PublicKey) => pda([Buffer.from("vault"), asset.toBuffer()]);
  const mintPda = (asset: PublicKey) => pda([Buffer.from("mint"), asset.toBuffer()]);
  const oraclePda = (asset: PublicKey) =>
    pda([Buffer.from("mock_oracle"), asset.toBuffer()]);

  // --- 1. test USDC ---------------------------------------------------------

  const cacheDir = join(root, ".devnet");
  const mintCache = join(cacheDir, "usdc-mint.json");
  mkdirSync(cacheDir, { recursive: true });

  // Created from a keypair we hold, rather than one `createMint` generates
  // internally, so the address can actually be cached and reused. A mint created
  // any other way is unrecoverable: only its public key would survive, and the
  // next run would point at a mint whose authority key nobody has.
  let mintKeypair: Keypair;
  if (existsSync(mintCache)) {
    mintKeypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(mintCache, "utf8")))
    );
  } else {
    mintKeypair = Keypair.generate();
    writeFileSync(mintCache, JSON.stringify(Array.from(mintKeypair.secretKey)));
  }
  const usdcMint = mintKeypair.publicKey;

  if (await connection.getAccountInfo(usdcMint)) {
    console.log(`USDC mint  ${usdcMint.toBase58()} (cached)`);
  } else {
    await createMint(connection, admin, admin.publicKey, null, DECIMALS, mintKeypair);
    console.log(`USDC mint  ${usdcMint.toBase58()} (created)`);
  }

  const adminUsdc = (
    await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, admin.publicKey)
  ).address;

  const adminUsdcBalance = await connection
    .getTokenAccountBalance(adminUsdc)
    .then((r) => BigInt(r.value.amount))
    .catch(() => 0n);
  const needed = VAULT_FUNDING * BigInt(ASSETS.length);
  if (adminUsdcBalance < needed) {
    const toMint = ADMIN_MINT_SUPPLY;
    await mintTo(connection, admin, usdcMint, adminUsdc, admin, toMint);
    console.log(`minted     ${Number(toMint) / 1e6} test USDC to the admin`);
  } else {
    console.log(`admin USDC ${Number(adminUsdcBalance) / 1e6} (sufficient)`);
  }

  // --- 2. protocol ---------------------------------------------------------

  const protocolExists = (await connection.getAccountInfo(protocolPda)) !== null;
  if (protocolExists) {
    console.log("\nprotocol   already initialized");
  } else {
    await program.methods
      .initialize({ usdcMint, spreadBps: SPREAD_BPS })
      .accountsStrict({
        admin: admin.publicKey,
        protocol: protocolPda,
        systemProgram: SystemProgram.programId
      })
      .rpc();
    console.log("\nprotocol   initialized");
  }

  // --- 3-5. assets, prices, reserves ---------------------------------------

  const out: Record<string, unknown> = {};
  for (const [index, spec] of ASSETS.entries()) {
    const asset = assetPda(index);
    const vault = vaultPda(asset);
    const mint = mintPda(asset);

    const exists = (await connection.getAccountInfo(asset)) !== null;
    if (exists) {
      console.log(`\n${spec.symbol.padEnd(6)} already registered (id ${index})`);
    } else {
      await program.methods
        .registerAsset({
          symbol: symbol(spec.symbol),
          priceSource: { mock: {} },
          priceFeed: PublicKey.default,
          decimals: DECIMALS
        })
        .accountsStrict({
          admin: admin.publicKey,
          protocol: protocolPda,
          asset,
          vault,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId
        })
        .rpc();
      console.log(`\n${spec.symbol.padEnd(6)} registered (id ${index})`);
    }

    // Safe to repeat: the oracle is `init_if_needed`, so this also serves as the
    // way to move a price.
    await program.methods
      .setMockPrice(new anchor.BN(usd(spec.price).toString()))
      .accountsStrict({
        admin: admin.publicKey,
        protocol: protocolPda,
        asset,
        mockOracle: oraclePda(asset),
        systemProgram: SystemProgram.programId
      })
      .rpc();
    console.log(`  price  $${spec.price.toFixed(2)}`);

    const vaultUsdc = (
      await withRetry(`${spec.symbol} reserve account`, () =>
        getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, vault, true)
      )
    ).address;

    const recorded = await program.account.assetVault.fetch(vault);
    if (BigInt(recorded.usdcReserve.toString()) === 0n) {
      await program.methods
        .fundVault(new anchor.BN(VAULT_FUNDING.toString()))
        .accountsStrict({
          admin: admin.publicKey,
          protocol: protocolPda,
          vault,
          vaultUsdc,
          adminUsdc,
          tokenProgram: TOKEN_PROGRAM_ID
        })
        .rpc();
      console.log(`  reserve funded with ${Number(VAULT_FUNDING) / 1e6} test USDC`);
    } else {
      console.log(
        `  reserve already ${Number(recorded.usdcReserve.toString()) / 1e6} test USDC`
      );
    }

    out[spec.symbol] = {
      id: index,
      asset: asset.toBase58(),
      vault: vault.toBase58(),
      mint: mint.toBase58(),
      oracle: oraclePda(asset).toBase58(),
      vaultUsdc: vaultUsdc.toBase58(),
      price: spec.price
    };

    // Pace the loop: each asset sends three or four transactions, and devnet
    // starts returning 429 well before that becomes a real problem locally.
    await sleep(400);
  }

  const state = {
    cluster: RPC,
    programId: program.programId.toBase58(),
    usdcMint: usdcMint.toBase58(),
    protocol: protocolPda.toBase58(),
    admin: admin.publicKey.toBase58(),
    assets: out
  };
  writeFileSync(join(cacheDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);

  console.log(`\nwrote .devnet/state.json`);
  console.log(`set NEXT_PUBLIC_FOMO_PROGRAM_ID=${state.programId}`);
  console.log(`set NEXT_PUBLIC_USDC_MINT=${state.usdcMint}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
