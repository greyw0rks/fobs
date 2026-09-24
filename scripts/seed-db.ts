/**
 * Seed the database with the five assets and the four test users.
 *
 * Run: pnpm seed:db        (SQLite dev, via DATABASE_URL=file:./dev.db)
 *
 * Reads `.devnet/state.json`, so `pnpm devnet:bootstrap && pnpm devnet:users`
 * must have run first.
 *
 * This writes *static configuration only*: which assets exist, what their
 * onchain addresses are, which wallet belongs to which user. It deliberately
 * does not write trades, holdings or prices — those are the indexer's, and a
 * second writer for them would be a second thing to keep in sync. The split is
 * the same one the schema comments describe: addresses are facts about the
 * deployment, trades are facts about the chain.
 *
 * Idempotent: every write is an upsert keyed on a natural unique field, so
 * re-running after a partial failure converges rather than duplicating.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const prisma = new PrismaClient();

/**
 * Verified 2026-09-18 against Pyth Hermes — see docs/PYTH_VERIFICATION.md.
 *
 * Stored even though every asset is `mock` on devnet, because the devnet
 * measurement (0/5 feeds fresh) is a fact about devnet, not about the assets:
 * all five were seconds old on mainnet. Keeping the ids here makes the mainnet
 * flip a config change.
 */
const PYTH_FEED_IDS: Record<string, string> = {
  sNVDA: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
  sAAPL: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  sMSFT: "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1",
  sTSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  sAMZN: "b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a"
};

/** The company each synthetic tracks. The UI renders "Synthetic NVDA" from the symbol. */
const UNDERLYING: Record<string, string> = {
  sNVDA: "NVIDIA",
  sAAPL: "Apple",
  sMSFT: "Microsoft",
  sTSLA: "Tesla",
  sAMZN: "Amazon"
};

const DECIMALS = 6;

/** grey follows Alice and Bob; Bob and Charlie follow Alice. */
const FOLLOWS: [string, string][] = [
  ["grey", "alice"],
  ["grey", "bob"],
  ["alice", "grey"],
  ["bob", "alice"],
  ["charlie", "alice"]
];

type State = {
  assets: Record<
    string,
    {
      id: number;
      asset: string;
      vault: string;
      mint: string;
      oracle: string;
      price: number;
    }
  >;
  users?: Record<string, { wallet: string; displayName?: string }>;
};

async function main() {
  const statePath = join(root, ".devnet", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as State;

  const assets = Object.entries(state.assets ?? {});
  if (assets.length === 0) {
    throw new Error(`${statePath} lists no assets. Run \`pnpm devnet:bootstrap\`.`);
  }
  const users = Object.entries(state.users ?? {});
  if (users.length === 0) {
    throw new Error(`${statePath} lists no users. Run \`pnpm devnet:users\` first.`);
  }

  for (const [symbol, asset] of assets) {
    await prisma.asset.upsert({
      where: { symbol },
      create: {
        symbol,
        name: UNDERLYING[symbol] ?? symbol,
        onchainId: asset.id,
        assetAddress: asset.asset,
        mintAddress: asset.mint,
        vaultAddress: asset.vault,
        oracleAddress: asset.oracle,
        priceFeedType: "mock",
        pythFeedId: PYTH_FEED_IDS[symbol] ?? null,
        decimals: DECIMALS
        // cachedPrice intentionally omitted: it is the indexer's to write, and
        // the program prices trades from the oracle account, never from here.
      },
      update: {
        onchainId: asset.id,
        assetAddress: asset.asset,
        mintAddress: asset.mint,
        vaultAddress: asset.vault,
        oracleAddress: asset.oracle
      }
    });
    console.log(`asset  ${symbol.padEnd(6)} id ${asset.id}  ${asset.asset}`);
  }

  for (const [username, user] of users) {
    await prisma.user.upsert({
      where: { username },
      create: {
        username,
        displayName: user.displayName ?? username,
        walletAddress: user.wallet,
        // The server holds these keys so the /dev harness can sign real trades
        // as them. Never true for a user who arrived through authentication.
        isTestUser: true,
        // And they are the room every new account is furnished with: the
        // activity loop trades as them, and `followSeedTraders` makes every new
        // signup follow all of them. Set here rather than inferred from
        // `isTestUser`, because "we can sign for them" and "they are worth
        // following" are different claims — see the note on the field.
        isSeedTrader: true,
        onboardedAt: new Date()
      },
      // Both flags on update, so re-seeding after adding traders to the list
      // converges an existing database rather than only fixing new rows.
      update: { walletAddress: user.wallet, isTestUser: true, isSeedTrader: true }
    });
    console.log(`user   ${username.padEnd(8)} ${user.wallet}`);
  }

  // Second pass: follows need both users to exist.
  for (const [follower, following] of FOLLOWS) {
    const [from, to] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { username: follower } }),
      prisma.user.findUniqueOrThrow({ where: { username: following } })
    ]);
    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId: from.id, followingId: to.id } },
      create: { followerId: from.id, followingId: to.id },
      update: {}
    });
    console.log(`follow ${follower} → ${following}`);
  }

  const counts = {
    assets: await prisma.asset.count(),
    users: await prisma.user.count(),
    follows: await prisma.follow.count()
  };
  console.log(`\n${counts.assets} assets, ${counts.users} users, ${counts.follows} follows`);
  console.log("next: start the app and refresh the indexer from /dev");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
