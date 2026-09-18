import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";
import { connection, toBaseUnits } from "@/lib/solana/config";
import { buildTradeTransaction } from "@/lib/solana/trade";
import { indexAsset, type IndexResult } from "./indexer";
import { signerForUsername } from "./onboarding";

/**
 * Sign and send a real trade, then index it.
 *
 * The order matters and is the whole point: the trade goes to Solana first, and
 * the row that appears in the feed is the one the indexer read back off the
 * chain. Nothing writes a `Trade` from this function's input, so a trade that
 * fails on chain leaves no row behind and no feed item claiming otherwise.
 *
 * The receipt PDA is returned by the builder and *verified* after confirmation
 * rather than assumed — if the transaction landed, that account exists, and if
 * it does not, the trade did not really happen.
 */

export type ExecutedTrade = {
  /** The row the indexer wrote after reading the receipt back off the chain. */
  tradeId: string;
  receipt: string;
  signature: string;
  /**
   * What the index pass that followed the send actually did. Returned rather
   * than discarded so a caller can tell "the trade landed and was indexed" from
   * "the trade landed and the indexer found nothing", which look identical from
   * the receipt address alone.
   */
  indexed: IndexResult;
};

export async function executeTradeAsTestUser(input: {
  username: string;
  symbol: string;
  side: "buy" | "sell";
  /** USDC notional. `500` is $500. */
  amountUsdc: number;
  /** The trade being FOMO'd, if any. */
  sourceTradeId?: string | null;
}): Promise<ExecutedTrade> {
  const { username, symbol, side, amountUsdc, sourceTradeId } = input;

  const signer = await signerForUsername(username);

  const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol } });

  // Provenance only. We pass the *receipt address* of the source trade, which is
  // what the program records; nothing about the source trade's size or price
  // travels with it.
  let sourceReceipt: PublicKey | null = null;
  if (sourceTradeId) {
    const source = await prisma.trade.findUniqueOrThrow({
      where: { id: sourceTradeId },
      select: { onchainReceipt: true }
    });
    sourceReceipt = new PublicKey(source.onchainReceipt);
  }

  const { transaction, receipt } = await buildTradeTransaction({
    owner: signer.publicKey,
    asset: {
      onchainId: asset.onchainId,
      assetAddress: asset.assetAddress,
      vaultAddress: asset.vaultAddress,
      oracleAddress: asset.oracleAddress
    },
    side,
    amount: toBaseUnits(amountUsdc),
    sourceReceipt
  });

  transaction.feePayer = signer.publicKey;
  // The blockhash the transaction finally went out with, paired with the
  // signature below. Confirming against a *different* block's height would
  // silently turn the expiry check into a no-op.
  const { signature, blockhash, lastValidBlockHeight } = await signAndSend(
    transaction,
    signer
  );

  const confirmation = await connection().confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  if (confirmation.value.err) {
    throw new Error(
      `Transaction ${signature} failed on chain: ${JSON.stringify(confirmation.value.err)}`
    );
  }

  // The receipt is the proof. If it is not there, the trade is not real.
  const created = await connection().getAccountInfo(receipt);
  if (!created) {
    throw new Error(
      `Transaction ${signature} confirmed but receipt ${receipt.toBase58()} does not exist. Refusing to record a trade that is not on chain.`
    );
  }

  const indexed = await indexAsset(asset.id);

  // Read back what the indexer wrote, so the caller renders a row that came off
  // the chain rather than one built from this function's inputs.
  const row = await prisma.trade.findUnique({
    where: { onchainReceipt: receipt.toBase58() },
    select: { id: true }
  });
  if (!row) {
    throw new Error(
      `Receipt ${receipt.toBase58()} exists on chain but the indexer produced no trade row. ` +
        "The trade is real; the indexer is behind or failed."
    );
  }

  return { tradeId: row.id, receipt: receipt.toBase58(), signature, indexed };
}

/**
 * Is this the RPC rejecting the *blockhash* rather than answering about the
 * program?
 *
 * `api.devnet.solana.com` is a load-balanced pool, and the node that answers
 * `getLatestBlockhash` is not guaranteed to be the node that runs preflight.
 * When they differ, the simulation runs on a node that has never seen that
 * blockhash and rejects the transaction before it goes anywhere. It is
 * intermittent, it has nothing to do with the program, and it reads like a
 * program bug if you only see the message.
 */
function isBlockhashRejection(error: unknown): boolean {
  return /blockhash not found/i.test((error as Error)?.message ?? "");
}

/**
 * Fetch a blockhash, sign, and send — retrying the whole sequence if the RPC
 * rejects the blockhash.
 *
 * The retry has to be the whole sequence: a new blockhash changes the message,
 * which invalidates the signature, so re-sending the previously signed
 * transaction cannot help. `sendTransaction` signs in place and overwrites the
 * existing signature, so the same `Transaction` object can be re-signed.
 *
 * Only a preflight blockhash rejection is retried. That matters twice over:
 * with `skipPreflight: false` the RPC simulates before broadcasting, so a
 * rejected blockhash means nothing was sent and retrying cannot double-trade —
 * and any *other* error is the program's real answer, which is thrown on the
 * first attempt rather than hammered at.
 */
async function signAndSend(transaction: Transaction, signer: Keypair) {
  const attempts = 4;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { blockhash, lastValidBlockHeight } =
      await connection().getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;

    try {
      const signature = await send(transaction, signer);
      return { signature, blockhash, lastValidBlockHeight };
    } catch (error) {
      if (!isBlockhashRejection(error)) throw error;
      lastError = error;
      // The pool needs a moment to converge. No point rushing the last attempt.
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  throw new Error(
    `Gave up after ${attempts} attempts: the RPC kept rejecting the blockhash. ` +
      `Last error: ${(lastError as Error)?.message}`,
    { cause: lastError }
  );
}

async function send(transaction: Transaction, signer: Keypair) {
  try {
    return await connection().sendTransaction(transaction, [signer], {
      skipPreflight: false,
      preflightCommitment: "confirmed"
    });
  } catch (error) {
    // Anchor's preflight simulation returns the program's error, which is far
    // more useful than "Transaction failed" — but it arrives as a nested object
    // that `console.error` flattens into nothing useful.
    const logs = (error as { logs?: string[] }).logs;
    if (logs?.length) {
      throw new Error(`${(error as Error).message}\n\nProgram logs:\n${logs.join("\n")}`);
    }
    throw error;
  }
}
