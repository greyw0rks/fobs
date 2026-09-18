import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Fomo } from "../target/types/fomo";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo
} from "@solana/spl-token";
import { assert } from "chai";

/**
 * End-to-end run of the four core instructions against a real validator.
 *
 * The point is not that the instructions return Ok — it is that tokens actually
 * move and that the program's internal accounting agrees with the token
 * balances. Those two are asserted against each other throughout, because the
 * failure that matters for a vault is silent divergence between
 * `vault.usdc_reserve` and the USDC the vault really holds.
 *
 * Accounts are passed with `accountsStrict`, so every account is explicit. Some
 * of this program's PDAs seed off other accounts' *fields* (`asset.id`,
 * `asset.trade_count`), which the client cannot resolve from the IDL alone, so
 * deriving them here is the honest arrangement rather than a workaround.
 */

// --- integer math, mirroring programs/fomo/src/instructions/trade.rs ---------
// BigInt division truncates toward zero exactly like Rust's integer division,
// so these reproduce the program's rounding rather than approximating it.

const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));
const pow10 = (e: number) => 10n ** BigInt(e);

const applySpread = (price: bigint, bps: number, side: "buy" | "sell") =>
  (price * (side === "buy" ? 10_000n + BigInt(bps) : 10_000n - BigInt(bps))) / 10_000n;

const quoteQuantity = (amount: bigint, price: bigint, decimals: number) =>
  (amount * pow10(decimals)) / price;

const quotePayout = (quantity: bigint, price: bigint, decimals: number) =>
  (quantity * price) / pow10(decimals);

const toBn = (v: bigint) => new anchor.BN(v.toString());

const symbol = (s: string) => {
  const buf = Buffer.alloc(8);
  buf.write(s, "utf8");
  return Array.from(buf);
};

describe("fobs", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Fomo as Program<Fomo>;
  const connection = provider.connection;

  const admin = provider.wallet as anchor.Wallet;

  // The demo numbers from the design: a $178.24 share, 0.5% spread, 6 decimals.
  const SPREAD_BPS = 50;
  const DECIMALS = 6;
  const ORACLE_PRICE = USDC(178.24);
  const BUY_NOTIONAL = USDC(500);
  const RESERVE_FUNDING = USDC(10_000);

  let usdcMint: PublicKey;
  let assetPda: PublicKey;
  let vaultPda: PublicKey;
  let shareMint: PublicKey;
  let vaultUsdc: PublicKey;
  let adminUsdc: PublicKey;
  let adminShares: PublicKey;

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];

  const protocolPda = () => pda([Buffer.from("protocol")]);

  const u64le = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    return b;
  };

  // The seed encodings below have to match the Rust field widths exactly: the
  // program seeds `[Asset::SEED, &asset_count.to_le_bytes()]` where `asset_count`
  // is `u16`, so the seed is two bytes, not eight. Getting this wrong fails with
  // `ConstraintSeeds` and a pair of base58 addresses that look equally plausible.
  const u16le = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n);
    return b;
  };

  const assetPdaFor = (id: number) => pda([Buffer.from("asset"), u16le(id)]);
  const vaultPdaFor = (asset: PublicKey) => pda([Buffer.from("vault"), asset.toBuffer()]);
  const mintPdaFor = (asset: PublicKey) => pda([Buffer.from("mint"), asset.toBuffer()]);
  const mockOraclePda = (asset: PublicKey) =>
    pda([Buffer.from("mock_oracle"), asset.toBuffer()]);
  const holdingPda = (owner: PublicKey, asset: PublicKey) =>
    pda([Buffer.from("holding"), owner.toBuffer(), asset.toBuffer()]);
  /** `trade_count` is a `u64` on the asset, so this one seed really is 8 bytes. */
  const receiptPda = (asset: PublicKey, tradeCount: bigint) =>
    pda([Buffer.from("receipt"), asset.toBuffer(), u64le(tradeCount)]);

  /** The receipt PDA for the *next* trade on this asset. */
  async function nextReceiptPda() {
    const asset = await program.account.asset.fetch(assetPda);
    return receiptPda(assetPda, BigInt(asset.tradeCount.toString()));
  }

  /** Full account set for `trade`, so each case differs only in what it tests. */
  async function tradeAccounts(opts: {
    owner: PublicKey;
    ownerUsdc: PublicKey;
    ownerShares: PublicKey;
    priceAccount?: PublicKey;
  }) {
    return {
      owner: opts.owner,
      protocol: protocolPda(),
      asset: assetPda,
      vault: vaultPda,
      mint: shareMint,
      vaultUsdc,
      ownerUsdc: opts.ownerUsdc,
      ownerShares: opts.ownerShares,
      holding: holdingPda(opts.owner, assetPda),
      receipt: await nextReceiptPda(),
      priceAccount: opts.priceAccount ?? mockOraclePda(assetPda),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId
    };
  }

  /**
   * The invariant that matters: the reserve the program believes it holds must
   * equal the USDC actually sitting in the vault's token account.
   */
  async function assertReserveMatchesTokens(label: string) {
    const vault = await program.account.assetVault.fetch(vaultPda);
    const onchain = await getAccount(connection, vaultUsdc);
    assert.equal(
      vault.usdcReserve.toString(),
      onchain.amount.toString(),
      `${label}: vault.usdcReserve disagrees with the vault's actual USDC balance`
    );
    return vault;
  }

  before(async () => {
    // A stand-in for USDC: 6 decimals, admin-controlled mint.
    usdcMint = await createMint(connection, admin.payer, admin.publicKey, null, DECIMALS);

    adminUsdc = (
      await getOrCreateAssociatedTokenAccount(connection, admin.payer, usdcMint, admin.publicKey)
    ).address;
    // The reserve has to be genuinely funded: buys move real USDC in, and sells
    // can only pay out what is actually there.
    await mintTo(connection, admin.payer, usdcMint, adminUsdc, admin.publicKey, 1_000_000_000_000);
  });

  it("initializes the protocol", async () => {
    await program.methods
      .initialize({ usdcMint, spreadBps: SPREAD_BPS })
      .accountsStrict({
        admin: admin.publicKey,
        protocol: protocolPda(),
        systemProgram: SystemProgram.programId
      })
      .rpc();

    const protocol = await program.account.protocol.fetch(protocolPda());
    assert.equal(protocol.usdcMint.toBase58(), usdcMint.toBase58());
    assert.equal(protocol.spreadBps, SPREAD_BPS);
    assert.equal(protocol.assetCount, 0, "asset counter should start at zero");
    assert.equal(protocol.admin.toBase58(), admin.publicKey.toBase58());
  });

  it("registers sNVDA, creating its mint and vault", async () => {
    assetPda = assetPdaFor(0);
    vaultPda = vaultPdaFor(assetPda);
    shareMint = mintPdaFor(assetPda);

    await program.methods
      .registerAsset({
        symbol: symbol("sNVDA"),
        priceSource: { mock: {} },
        priceFeed: PublicKey.default,
        decimals: DECIMALS
      })
      .accountsStrict({
        admin: admin.publicKey,
        protocol: protocolPda(),
        asset: assetPda,
        vault: vaultPda,
        mint: shareMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    const asset = await program.account.asset.fetch(assetPda);
    assert.equal(Buffer.from(asset.symbol).toString("utf8").replace(/\0+$/, ""), "sNVDA");
    assert.equal(asset.mint.toBase58(), shareMint.toBase58());
    assert.equal(asset.vault.toBase58(), vaultPda.toBase58());
    assert.deepEqual(asset.priceSource, { mock: {} });
    assert.equal(asset.decimals, DECIMALS);
    assert.equal(asset.tradeCount.toString(), "0");

    // The mint is real onchain, and the vault PDA — not a keypair — is its
    // authority, so issuance is controlled by the program.
    const mintInfo = await connection.getAccountInfo(shareMint);
    assert.isNotNull(mintInfo, "share mint was not created onchain");
    assert.equal(mintInfo!.owner.toBase58(), TOKEN_PROGRAM_ID.toBase58());

    const vault = await program.account.assetVault.fetch(vaultPda);
    assert.equal(vault.usdcReserve.toString(), "0");
    assert.equal(vault.sharesOutstanding.toString(), "0");

    const protocol = await program.account.protocol.fetch(protocolPda());
    assert.equal(protocol.assetCount, 1, "asset counter should have advanced");
  });

  it("sets a mock price and creates the reserve token accounts", async () => {
    await program.methods
      .setMockPrice(toBn(ORACLE_PRICE))
      .accountsStrict({
        admin: admin.publicKey,
        protocol: protocolPda(),
        asset: assetPda,
        mockOracle: mockOraclePda(assetPda),
        systemProgram: SystemProgram.programId
      })
      .rpc();

    const oracle = await program.account.mockOracle.fetch(mockOraclePda(assetPda));
    assert.equal(oracle.asset.toBase58(), assetPda.toBase58());
    assert.equal(oracle.price.toString(), ORACLE_PRICE.toString());

    // The vault's USDC account is owned by the vault PDA, so the program can
    // sign payouts from it without holding a key.
    vaultUsdc = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        admin.payer,
        usdcMint,
        vaultPda,
        true // allowOwnerOffCurve: the vault is a PDA
      )
    ).address;

    adminShares = (
      await getOrCreateAssociatedTokenAccount(connection, admin.payer, shareMint, admin.publicKey)
    ).address;
  });

  it("funds the vault with real USDC", async () => {
    const before = await getAccount(connection, adminUsdc);

    await program.methods
      .fundVault(toBn(RESERVE_FUNDING))
      .accountsStrict({
        admin: admin.publicKey,
        protocol: protocolPda(),
        vault: vaultPda,
        vaultUsdc,
        adminUsdc,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .rpc();

    const after = await getAccount(connection, adminUsdc);
    assert.equal(
      (before.amount - after.amount).toString(),
      RESERVE_FUNDING.toString(),
      "admin's USDC should have decreased by exactly the funding amount"
    );

    const vault = await assertReserveMatchesTokens("after fund_vault");
    assert.equal(vault.usdcReserve.toString(), RESERVE_FUNDING.toString());
  });

  it("buys shares: USDC in, shares minted", async () => {
    const adminBefore = await getAccount(connection, adminUsdc);
    const receiptPdaForTrade = await nextReceiptPda();

    await program.methods
      .trade({ side: { buy: {} }, amount: toBn(BUY_NOTIONAL), sourceReceipt: null })
      .accountsStrict(
        await tradeAccounts({
          owner: admin.publicKey,
          ownerUsdc: adminUsdc,
          ownerShares: adminShares
        })
      )
      .rpc();

    // Reproduce the program's own arithmetic and require an exact match.
    const expectedPrice = applySpread(ORACLE_PRICE, SPREAD_BPS, "buy");
    const expectedQty = quoteQuantity(BUY_NOTIONAL, expectedPrice, DECIMALS);
    assert.isAbove(Number(expectedQty), 0);

    const adminAfter = await getAccount(connection, adminUsdc);
    assert.equal(
      (adminBefore.amount - adminAfter.amount).toString(),
      BUY_NOTIONAL.toString(),
      "buyer should have paid exactly the notional"
    );

    const shares = await getAccount(connection, adminShares);
    assert.equal(
      shares.amount.toString(),
      expectedQty.toString(),
      "shares received should match floor(amount * 10^d / price)"
    );

    const vault = await assertReserveMatchesTokens("after buy");
    assert.equal(
      vault.usdcReserve.toString(),
      (RESERVE_FUNDING + BUY_NOTIONAL).toString(),
      "reserve should have grown by the notional"
    );
    assert.equal(vault.sharesOutstanding.toString(), expectedQty.toString());

    const holding = await program.account.holding.fetch(holdingPda(admin.publicKey, assetPda));
    assert.equal(holding.quantity.toString(), expectedQty.toString());
    // The program books the average entry as cost / shares-received. The shares
    // were floored, so the true average is the quote rounded *up* to the next
    // base unit — asserting equality with the quoted price would be asserting
    // arithmetic that does not hold.
    assert.equal(
      holding.avgPrice.toString(),
      ((BUY_NOTIONAL * pow10(DECIMALS)) / expectedQty).toString()
    );
    assert.isAtLeast(
      Number(holding.avgPrice),
      Number(expectedPrice),
      "flooring the share count must not book a better average entry than the quote"
    );

    const receipt = await program.account.tradeReceipt.fetch(receiptPdaForTrade);
    // The IDL types `side` as the Rust enum, so it comes back as `{ buy: {} }`
    // rather than a discriminant.
    assert.deepEqual(receipt.side, { buy: {} }, "receipt should record a buy");
    assert.equal(receipt.amountUsdc.toString(), BUY_NOTIONAL.toString());
    assert.equal(receipt.quantity.toString(), expectedQty.toString());
    assert.equal(receipt.price.toString(), expectedPrice.toString());
    assert.isNull(receipt.sourceReceipt, "a plain trade has no FOMO source");

    const asset = await program.account.asset.fetch(assetPda);
    assert.equal(asset.tradeCount.toString(), "1");
  });

  it("sells shares: shares burned, USDC out, reserve never drained", async () => {
    const sharesBefore = await getAccount(connection, adminShares);
    const usdcBefore = await getAccount(connection, adminUsdc);
    const vaultBefore = await assertReserveMatchesTokens("before sell");

    // Sell the entire position back.
    //
    // `amount` is a USDC notional on both sides of the book — a sell is not
    // "burn N shares", it is "sell N USDC worth" — so closing a position means
    // asking for what the shares are worth at the sell price. `quotePayout`
    // floors, and the program floors again converting back to shares, so the
    // exact worth can land one share short; asking for the next base unit up
    // lands on the whole position. (Beyond that it would overshoot and be
    // rejected by `InsufficientHolding`, which is the safe direction.)
    const sellPrice = applySpread(ORACLE_PRICE, SPREAD_BPS, "sell");
    const sellNotional = quotePayout(sharesBefore.amount, sellPrice, DECIMALS) + 1n;

    await program.methods
      .trade({ side: { sell: {} }, amount: toBn(sellNotional), sourceReceipt: null })
      .accountsStrict(
        await tradeAccounts({
          owner: admin.publicKey,
          ownerUsdc: adminUsdc,
          ownerShares: adminShares
        })
      )
      .rpc();

    const expectedPayout = quotePayout(sharesBefore.amount, sellPrice, DECIMALS);

    const sharesAfter = await getAccount(connection, adminShares);
    assert.equal(sharesAfter.amount.toString(), "0", "the whole position should be burned");

    const usdcAfter = await getAccount(connection, adminUsdc);
    assert.equal(
      (usdcAfter.amount - usdcBefore.amount).toString(),
      expectedPayout.toString(),
      "seller should receive exactly floor(shares * price / 10^d)"
    );

    const vaultAfter = await assertReserveMatchesTokens("after sell");
    assert.equal(
      vaultAfter.usdcReserve.toString(),
      // `usdcReserve` decodes to an anchor BN; the expected side is BigInt.
      (BigInt(vaultBefore.usdcReserve.toString()) - expectedPayout).toString()
    );
    assert.equal(vaultAfter.sharesOutstanding.toString(), "0");

    // Paying out against the shares actually burned — rather than the requested
    // notional — is what stops a sell from draining the reserve one base unit at
    // a time. The spread is the vault's only revenue, so a buy/sell round trip
    // must leave it better off.
    assert.isAbove(
      Number(vaultAfter.usdcReserve),
      Number(RESERVE_FUNDING),
      "round-tripping a buy and a sell drained the reserve"
    );
  });

  it("records a FOMO without copying the trade it came from", async () => {
    // A second trader. The point of FOMO is that the follower opens their own
    // position at their own size — nothing is mirrored from the source trade.
    const bob = Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(bob.publicKey, 2 * LAMPORTS_PER_SOL)
    );

    const bobUsdc = (
      await getOrCreateAssociatedTokenAccount(connection, admin.payer, usdcMint, bob.publicKey)
    ).address;
    await mintTo(connection, admin.payer, usdcMint, bobUsdc, admin.publicKey, 1_000_000_000);
    const bobShares = (
      await getOrCreateAssociatedTokenAccount(connection, admin.payer, shareMint, bob.publicKey)
    ).address;

    // The trade Bob is FOMOing, published before he acts.
    const sourcePda = receiptPda(assetPda, 0n);
    const source = await program.account.tradeReceipt.fetch(sourcePda);
    const bobNotional = USDC(50); // deliberately a different size to the source
    // Read the receipt index off the asset rather than hard-coding it, so this
    // test does not silently start reading the previous trade's receipt when an
    // earlier case changes how many trades have run.
    const bobReceiptPda = await nextReceiptPda();

    await program.methods
      .trade({ side: { buy: {} }, amount: toBn(bobNotional), sourceReceipt: sourcePda })
      .accountsStrict(
        await tradeAccounts({ owner: bob.publicKey, ownerUsdc: bobUsdc, ownerShares: bobShares })
      )
      .signers([bob])
      .rpc();

    const bobReceipt = await program.account.tradeReceipt.fetch(bobReceiptPda);

    // The provenance link exists...
    assert.equal(
      bobReceipt.sourceReceipt!.toBase58(),
      sourcePda.toBase58(),
      "the receipt should record which trade this FOMOed"
    );
    // ...but Bob's trade is his own.
    assert.equal(bobReceipt.owner.toBase58(), bob.publicKey.toBase58());
    assert.equal(bobReceipt.amountUsdc.toString(), bobNotional.toString());
    assert.notEqual(
      bobReceipt.amountUsdc.toString(),
      source.amountUsdc.toString(),
      "Bob's trade must not mirror the size of the trade he FOMOed"
    );

    const bobHolding = await program.account.holding.fetch(holdingPda(bob.publicKey, assetPda));
    assert.isAbove(Number(bobHolding.quantity), 0, "Bob should hold his own position");

    const aliceHolding = await program.account.holding.fetch(holdingPda(admin.publicKey, assetPda));
    assert.equal(
      aliceHolding.quantity.toString(),
      "0",
      "Bob's FOMO should not touch Alice's position"
    );

    await assertReserveMatchesTokens("after FOMO");
  });

  it("rejects a trade priced by an account the asset does not point at", async () => {
    // A second asset's oracle must not be usable for the first asset.
    const aaplAsset = assetPdaFor(1);
    await program.methods
      .registerAsset({
        symbol: symbol("sAAPL"),
        priceSource: { mock: {} },
        priceFeed: PublicKey.default,
        decimals: DECIMALS
      })
      .accountsStrict({
        admin: admin.publicKey,
        protocol: protocolPda(),
        asset: aaplAsset,
        vault: vaultPdaFor(aaplAsset),
        mint: mintPdaFor(aaplAsset),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    await program.methods
      .setMockPrice(toBn(USDC(200)))
      .accountsStrict({
        admin: admin.publicKey,
        protocol: protocolPda(),
        asset: aaplAsset,
        mockOracle: mockOraclePda(aaplAsset),
        systemProgram: SystemProgram.programId
      })
      .rpc();

    const strayShares = (
      await getOrCreateAssociatedTokenAccount(connection, admin.payer, shareMint, admin.publicKey)
    ).address;

    try {
      await program.methods
        .trade({ side: { buy: {} }, amount: toBn(USDC(10)), sourceReceipt: null })
        .accountsStrict(
          await tradeAccounts({
            owner: admin.publicKey,
            ownerUsdc: adminUsdc,
            ownerShares: strayShares,
            // sAAPL's oracle, not sNVDA's.
            priceAccount: mockOraclePda(aaplAsset)
          })
        )
        .rpc();
      assert.fail("trading against another asset's price account should fail");
    } catch (error) {
      assert.include(
        String(error),
        "WrongPriceAccount",
        `expected WrongPriceAccount, got: ${error}`
      );
    }
  });

  it("rejects a non-admin calling an admin instruction", async () => {
    const mallory = Keypair.generate();
    await connection.confirmTransaction(
      await connection.requestAirdrop(mallory.publicKey, 2 * LAMPORTS_PER_SOL)
    );

    try {
      await program.methods
        .setMockPrice(toBn(USDC(1)))
        .accountsStrict({
          admin: mallory.publicKey,
          protocol: protocolPda(),
          asset: assetPda,
          mockOracle: mockOraclePda(assetPda),
          systemProgram: SystemProgram.programId
        })
        .signers([mallory])
        .rpc();
      assert.fail("a non-admin must not be able to set the price");
    } catch (error) {
      assert.include(String(error), "Unauthorized", `expected Unauthorized, got: ${error}`);
    }
  });
});
