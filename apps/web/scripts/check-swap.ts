/**
 * The bridge's core new capability, verified end to end without signing.
 *
 * A quote is a number; a swap is a transaction. This asserts that `quoteSwap`
 * followed by `buildSwapTransaction` produces a real, deserialisable
 * VersionedTransaction whose fee payer is the wallet we asked for — the exact
 * object `/api/trades/prepare` will hand the browser. Nothing is signed and
 * nothing is sent, so it needs no funds and touches no key.
 *
 * Run: `pnpm check:swap`
 */

import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { usdcMint } from "@/lib/solana/config";
import { routedEquityFor } from "@/lib/server/routed-equities";
import { buildSwapTransaction, quoteSwap } from "@/lib/server/quote";

function decode(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

let failures = 0;
function ok(label: string, condition: boolean, detail = "") {
  console.log(`${condition ? "ok  " : "FAIL"}   ${label}${detail ? `  ${detail}` : ""}`);
  if (!condition) failures++;
}

async function main() {
  // A real, deep, tradeable mint: the NVDA xStock. If the pin has drifted this
  // throws, which is the correct failure — we do not want to build a swap into
  // a mint we could not validate.
  const nvda = await routedEquityFor("Backed", "NVDA");
  console.log(`NVDAx ${nvda.mint} (${nvda.decimals} decimals)\n`);

  // $10 of USDC in. USDC is 6 decimals, same as the app's BASE.
  const quote = await quoteSwap({
    inputMint: usdcMint().toBase58(),
    outputMint: nvda.mint,
    amount: 10_000_000n,
    policy: null // xStocks are not the fee-bearing case; the swap builds regardless.
  });
  ok("a quote returns a positive output", quote.outAmount > 0n, `${quote.outAmount} base units`);
  ok("the raw jupiter quote is carried for /swap", Object.keys(quote.jupiterQuote).length > 0);

  const wallet = Keypair.generate().publicKey;
  const built = await buildSwapTransaction({ quote, userPublicKey: wallet.toBase58() });
  ok("a swap transaction is returned", built.swapTransaction.length > 0);

  // The real assertion: it deserialises as a VersionedTransaction, and its fee
  // payer is the wallet we built it for — not some default, not the pool.
  const tx = VersionedTransaction.deserialize(decode(built.swapTransaction));
  const feePayer = tx.message.staticAccountKeys[0];
  ok("it deserialises as a VersionedTransaction", tx.message.staticAccountKeys.length > 0);
  ok(
    "the fee payer is the wallet we asked for",
    feePayer?.equals(wallet) ?? false,
    feePayer?.toBase58() ?? "none"
  );
  ok(
    "it is unsigned — the browser signs, not us",
    tx.signatures.every((sig) => sig.every((byte) => byte === 0))
  );

  // The sell direction: the token goes in, USDC comes out. 0.01 NVDAx at 8
  // decimals. This is the leg that used to 400 with `amount_required`.
  const sellAmount = BigInt(Math.round(0.01 * 10 ** nvda.decimals));
  const sellQuote = await quoteSwap({
    inputMint: nvda.mint,
    outputMint: usdcMint().toBase58(),
    amount: sellAmount,
    policy: null
  });
  ok("a sell quote returns USDC out", sellQuote.outAmount > 0n, `${sellQuote.outAmount} base units`);
  const sell = await buildSwapTransaction({ quote: sellQuote, userPublicKey: wallet.toBase58() });
  const sellTx = VersionedTransaction.deserialize(decode(sell.swapTransaction));
  ok("a sell swap deserialises", sellTx.message.staticAccountKeys.length > 0);
  ok(
    "the sell fee payer is the wallet we asked for",
    sellTx.message.staticAccountKeys[0]?.equals(wallet) ?? false
  );

  console.log(`\n${failures === 0 ? "all ok" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
