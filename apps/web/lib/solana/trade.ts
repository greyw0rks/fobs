import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction
} from "@solana/web3.js";
import {
  assetPda,
  holdingPda,
  mockOraclePda,
  protocolPda,
  receiptPda,
  vaultPda,
  vaultUsdcAddress
} from "./pdas";
import { connection as defaultConnection, usdcMint } from "./config";
import type { FomoAccounts } from "./accounts";
import idlJson from "./fomo.idl.json";

const idl = idlJson as unknown as anchor.Idl;

/**
 * A provider exists only so Anchor can build instruction data; nothing here
 * signs. The wallet is a stub for the same reason — the keypair that signs a
 * transaction is supplied later, by whoever sends it (a server-held test-user
 * key, or the browser wallet adapter).
 */
function readOnlyProvider(conn: Connection, payer: PublicKey) {
  return new anchor.AnchorProvider(
    conn,
    {
      publicKey: payer,
      signTransaction: async () => {
        throw new Error("buildTradeTransaction never signs; send the transaction yourself");
      },
      signAllTransactions: async () => {
        throw new Error("buildTradeTransaction never signs; send the transaction yourself");
      }
    },
    { commitment: "confirmed" }
  );
}

/**
 * A `Program` whose `account` namespace is typed.
 *
 * `anchor.Program<Idl>` cannot type `account` here: the IDL is a JSON import, so
 * every account name widens to `string` and the per-account keys are lost. See
 * `lib/solana/accounts.ts`.
 */
export type FomoProgram = Omit<anchor.Program<anchor.Idl>, "account"> & {
  account: FomoAccounts;
};

export function program(conn: Connection, payer: PublicKey): FomoProgram {
  // Through `unknown` deliberately: the object really does have a working
  // `account` namespace, TypeScript just cannot get there from `Program<Idl>`.
  return new anchor.Program(idl, readOnlyProvider(conn, payer)) as unknown as FomoProgram;
}

/** The addresses a trade needs, all derived from the asset's onchain id. */
export type TradeAsset = {
  onchainId: number;
  assetAddress: string;
  vaultAddress: string;
  oracleAddress: string | null;
};

export type TradeRequest = {
  owner: PublicKey;
  asset: TradeAsset;
  side: "buy" | "sell";
  /** USDC notional in base units. `$500` is `500_000_000n`. */
  amount: bigint;
  /** The receipt this trade FOMOs, if any. Provenance only — never copied. */
  sourceReceipt?: PublicKey | null;
};

/**
 * The receipt PDA this trade will create.
 *
 * `Asset.trade_count` advances once per trade, so the *next* receipt is the one
 * at the current count. Read here rather than assumed, since a trade that landed
 * after our last read would shift it.
 */
export async function nextReceiptPda(
  conn: Connection,
  asset: TradeAsset
): Promise<{ receipt: PublicKey; tradeCount: bigint; mint: PublicKey }> {
  const account = await program(conn, PublicKey.default).account.asset.fetch(
    new PublicKey(asset.assetAddress)
  );
  // The IDL is snake_case; `convertIdlToCamelCase` runs inside the Program
  // constructor, so these really are camelCase here. See HANDOFF sharp edge 12.
  const tradeCount = BigInt(account.tradeCount.toString());
  const assetKey = new PublicKey(asset.assetAddress);
  return {
    receipt: receiptPda(assetKey, tradeCount),
    tradeCount,
    mint: new PublicKey(account.mint.toBase58())
  };
}

/**
 * Build a complete trade transaction: any missing token accounts first, then the
 * program's `trade`.
 *
 * The share ATA has to exist before `trade` runs — the program declares
 * `owner_shares` as a plain `Account<TokenAccount>`, not `init_if_needed`, so
 * the first buy for any (user, asset) pair fails without this. Creating it
 * conditionally rather than always keeps repeat trades to a single instruction
 * and avoids paying for an account that is already there.
 */
export async function buildTradeTransaction(
  request: TradeRequest,
  conn: Connection = defaultConnection()
): Promise<{ transaction: Transaction; receipt: PublicKey }> {
  const { owner, asset, side, amount, sourceReceipt } = request;
  if (amount <= 0n) throw new Error("Trade amount must be positive");

  const assetKey = new PublicKey(asset.assetAddress);
  const vault = new PublicKey(asset.vaultAddress);
  const usdc = usdcMint();

  const { receipt, mint } = await nextReceiptPda(conn, asset);

  const ownerUsdc = getAssociatedTokenAddressSync(usdc, owner);
  const ownerShares = getAssociatedTokenAddressSync(mint, owner);

  const transaction = new Transaction();

  const [usdcInfo, sharesInfo] = await conn.getMultipleAccountsInfo([
    ownerUsdc,
    ownerShares
  ]);
  const create = (
    account: PublicKey,
    mintKey: PublicKey
  ): TransactionInstruction =>
    createAssociatedTokenAccountInstruction(
      owner,
      account,
      owner,
      mintKey,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  if (!usdcInfo) transaction.add(create(ownerUsdc, usdc));
  if (!sharesInfo) transaction.add(create(ownerShares, mint));

  const priceAccount = asset.oracleAddress
    ? new PublicKey(asset.oracleAddress)
    : mockOraclePda(assetKey);

  const instruction = await program(conn, owner)
    .methods.trade({
      side: side === "buy" ? { buy: {} } : { sell: {} },
      amount: new anchor.BN(amount.toString()),
      sourceReceipt: sourceReceipt ?? null
    })
    .accountsStrict({
      owner,
      protocol: protocolPda(),
      asset: assetKey,
      vault,
      mint,
      vaultUsdc: vaultUsdcAddress(vault, usdc),
      ownerUsdc,
      ownerShares,
      holding: holdingPda(owner, assetKey),
      receipt,
      priceAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId
    })
    .instruction();

  transaction.add(instruction);
  return { transaction, receipt };
}
