import { SiteNav } from "@/components/SiteNav";
import { Reveal } from "@/components/fobs/motion";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Terms and disclosure.
 *
 * One page, and it exists because several things about this product are easy to
 * mistake for something they are not: the prices look like prices, the symbols
 * look like tickers, the USDC has a dollar sign, and the wallet is a wallet.
 *
 * The asset list is read from the database rather than written out here, so the
 * page cannot go stale when the tickers change — a disclosure that names the
 * wrong instruments is worse than none.
 */
export default async function TermsPage() {
  const assets = await prisma.asset.findMany({
    orderBy: { onchainId: "asc" },
    select: { symbol: true, name: true, priceFeedType: true, pythFeedId: true }
  });

  return (
    <main className="min-h-screen bg-[#f4f3ef] text-[#111312]">
      <SiteNav action={{ href: "/feed", label: "Back to the feed" }} />

      <Reveal>
        <article className="mx-auto max-w-[720px] px-6 py-12 lg:py-16">
        <header className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#3175c6]">
            Legal
          </p>
          <h1 className="mt-3 text-[44px] font-semibold leading-none tracking-[-0.05em]">
            Terms and disclosure
          </h1>
          <p className="mt-4 text-base leading-7 text-[#6e6f69]">
            What this is, what it is not, and the parts worth reading twice.
          </p>
        </header>

        <section className="mb-6 rounded-[18px] border border-[#e3e2dc] bg-[#eeeee9] p-6">
          <h3 className="text-base font-semibold">FOBS is a bridge, not a brokerage</h3>
          <p className="mt-3 text-sm leading-7 text-[#5c5d57]">
            Nothing here is an offer to buy or sell a security, and FOBS is not a
            broker, dealer, or custodian. It is a front-end that <em>routes</em> you
            into tokens that already trade on Solana mainnet: it mints nothing,
            holds no key, and takes no custody. Every trade is a swap your own
            wallet signs. The tokens are issued by third parties — not by FOBS —
            and they are not the underlying shares.
          </p>
        </section>

        <section className="mb-8">
          <h3 className="text-base font-semibold">The tokens</h3>
          <p className="mt-3 text-sm leading-7 text-[#777872]">
            The instruments below are real tokens that already trade on Solana
            mainnet, issued by third parties — Backed (xStocks), PreStocks, and
            Ondo — not by FOBS. Each is designed to represent exposure to a
            company, but a token is not the share itself: it carries no voting
            rights, pays no dividend, and its redemption and backing are the
            issuer&apos;s terms, not ours.
          </p>

          <div className="mt-5 overflow-hidden rounded-[18px] border border-[#e3e2dc] bg-white">
            {assets.map((asset) => (
              <div
                key={asset.symbol}
                className="flex items-start justify-between gap-4 border-b border-[#efeee9] px-5 py-4 last:border-b-0"
              >
                <span className="text-sm">
                  <strong>{asset.name}</strong>
                  <br />
                  <span className="text-xs text-[#777872]">
                    Ticker{" "}
                    <strong className="font-mono tabular-nums">{asset.symbol}</strong>,
                    issued by a third party
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-[#777872]">
                  {asset.priceFeedType === "pyth"
                    ? "Checked against a Pyth reference"
                    : "Priced by its live route"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <Section title="Prices">
          <p>
            Prices are read live from mainnet — a Jupiter route for what a swap
            would actually pay, or a Pyth reference for a listed equity — never a
            number this website invents. For listed names FOBS checks the venue
            price against its Pyth reference and refuses to route a trade when the
            two have dislocated. A quote is also shown net of the token&apos;s
            transfer fee, which the venue does not always subtract for you.
          </p>
          <p>
            The app shows a figure only where one was actually read. Where a price
            is missing it says so rather than showing a placeholder, and it does
            not compute a gain, a loss, or a percentage change from a price it does
            not have.
          </p>
        </Section>

        <Section title="USDC">
          <p>
            Trades are quoted and settled in real Circle USDC on Solana mainnet,
            held in your own wallet. FOBS never holds your USDC and never touches
            it — the swap moves it directly between your wallet and the venue.
          </p>
        </Section>

        <section className="mb-8 rounded-[18px] border border-[#e3e2dc] bg-[#eeeee9] p-6">
          <h3 className="text-base font-semibold">Custody — the part to read twice</h3>
          <p className="mt-3 text-sm leading-7 text-[#5c5d57]">
            <strong className="text-[#111312]">FOBS takes no custody and signs nothing.</strong>{" "}
            To trade you connect your own mainnet wallet; the swap is built by the
            server, signed in your browser, and forwarded — no private key ever
            reaches this server.
          </p>
          <p className="mt-3 text-sm leading-7 text-[#5c5d57]">
            There is no exception and no custodial mode. FOBS cannot create a
            wallet for you, cannot hold a key for you, and cannot sign anything on
            your behalf. Signing in with X or Google gives you an{" "}
            <em>identity</em>, not a wallet — to trade you still connect one you
            already hold. An earlier build offered a server-held demo key for
            trying the social layer on a test cluster; that option is gone, and
            nothing it left behind can hold or trade real value.{" "}
            <strong className="text-[#111312]">
              Never send real funds anywhere expecting FOBS to hold them
            </strong>{" "}
            — connect your own wallet and it stays yours.
          </p>
        </section>

        <Section title="What FOMO does">
          <p>
            Pressing FOMO on someone else&apos;s trade places{" "}
            <strong>your own trade</strong> — your size, your wallet, your
            signature, priced at the current market price. It is not a copy: it
            will not match their entry price, their quantity, or their timing. The
            only thing carried over is a reference to their trade, so both sides
            can see who inspired whom. You can lose money on a FOMO nobody else
            lost money on, including the person you copied.
          </p>
        </Section>

        <Section title="No warranty, no recourse">
          <p>
            This is software provided as-is, with no warranty of any kind. There
            is no support, no insurance, and no dispute process. Trades settle on
            mainnet and are irreversible; FOBS cannot reverse a swap or recover
            funds. The tokens, their issuers, and the liquidity you trade against
            are third parties outside FOBS&apos;s control, and a token&apos;s value
            can go to zero.
          </p>
        </Section>

        <Section title="Accounts and data">
          <p>
            Signing in with X or Google reads your public profile — your handle or
            name and avatar — to create an account, and never posts on your behalf
            or reads your contacts, posts, or messages. Your follows and trade
            history are stored in this deployment&apos;s database and mirrored from
            public mainnet state; they are not sold and not shared with anyone.
          </p>
        </Section>
      </article>
      </Reveal>
    </main>
  );
}

/** A plain reading-layout section: title plus muted prose paragraphs. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-3 space-y-3 text-sm leading-7 text-[#777872]">{children}</div>
    </section>
  );
}
