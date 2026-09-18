/**
 * Read the devnet deployment back off the chain and report what is actually
 * there.
 *
 * Run: pnpm devnet:verify
 *
 * Deliberately independent of scripts/devnet-bootstrap.ts: it re-derives every
 * PDA from the IDL and reads chain state rather than trusting the JSON the
 * bootstrap wrote. The point is to be able to tell "the bootstrap says it
 * worked" apart from "the chain agrees".
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const connection = new Connection(RPC, "confirmed");
const idl = JSON.parse(readFileSync("target/idl/fomo.json", "utf8"));
const program = new anchor.Program(
  idl as anchor.Idl,
  new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(anchor.web3.Keypair.generate()),
    { commitment: "confirmed" }
  )
);

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const u16le = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};

const EXPECTED = ["sNVDA", "sAAPL", "sMSFT", "sTSLA", "sAMZN"];

async function main() {
  console.log(`cluster ${RPC}`);
  console.log(`program ${program.programId.toBase58()}\n`);

  const protocol = await program.account.protocol.fetch(pda([Buffer.from("protocol")]));
  console.log(`asset_count ${protocol.assetCount}`);
  console.log(`spread_bps  ${protocol.spreadBps}`);
  console.log(`usdc_mint   ${protocol.usdcMint.toBase58()}\n`);

  let bad = 0;
  for (let id = 0; id < EXPECTED.length; id++) {
    const assetPk = pda([Buffer.from("asset"), u16le(id)]);
    const asset = await program.account.asset.fetch(assetPk);
    const vault = await program.account.assetVault.fetch(
      pda([Buffer.from("vault"), assetPk.toBuffer()])
    );
    const oracle = await program.account.mockOracle.fetch(
      pda([Buffer.from("mock_oracle"), assetPk.toBuffer()])
    );

    const symbol = Buffer.from(asset.symbol).toString("utf8").replace(/\0+$/, "");
    const matches = symbol === EXPECTED[id] && asset.id === id;
    if (!matches) bad++;

    console.log(
      `${matches ? "ok " : "BAD"} id=${asset.id} ${symbol.padEnd(6)}` +
        ` price=$${(Number(oracle.price) / 1e6).toFixed(2).padStart(8)}` +
        ` reserve=${(Number(vault.usdcReserve) / 1e6).toFixed(0).padStart(7)}` +
        ` shares=${vault.sharesOutstanding}`
    );
  }

  if (protocol.assetCount !== EXPECTED.length) {
    console.log(`\nBAD asset_count is ${protocol.assetCount}, expected ${EXPECTED.length}`);
    bad++;
  }
  if (bad > 0) {
    console.log(`\n${bad} problem(s) found`);
    process.exit(1);
  }
  console.log("\ndevnet state matches the five expected assets");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
