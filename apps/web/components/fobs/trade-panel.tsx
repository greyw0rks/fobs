// components/fobs/trade-panel.tsx
//
// The buy/sell panel from the stock detail frame. The Buy/Sell toggle and the
// primary CTA are black (actions); the "friends holding" list is the social
// proof that makes Fobs Fobs.

export function TradePanel({ symbol }: { symbol: string }) {
  return (
    <aside className="fobs-surface h-fit p-5">
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-[#f2f1ec] p-1">
        <button className="rounded-md bg-black py-2 text-xs text-white">Buy</button>

        <button className="py-2 text-xs text-[#777872]">Sell</button>
      </div>

      <div>
        <p className="text-[10px] text-[#85867f]">Your position</p>

        <p className="mt-1 text-lg font-semibold">0.00 {symbol}</p>
      </div>

      <div className="mt-5 flex justify-between text-xs">
        <span className="text-[#777872]">Available</span>
        <span>$3,200.00</span>
      </div>

      <label className="mt-5 block text-[10px] text-[#777872]">Amount</label>

      <input
        defaultValue="$500"
        className="mt-2 h-11 w-full rounded-lg border border-[#deddd7] bg-white px-3 text-sm outline-none"
      />

      <div className="mt-2 flex gap-1">
        {["$250", "$500", "$1K", "Max"].map((amount) => (
          <button
            key={amount}
            className="flex-1 rounded-md border border-[#e4e3dd] py-2 text-[9px]"
          >
            {amount}
          </button>
        ))}
      </div>

      <button className="fobs-button-primary mt-5 w-full">Buy {symbol} →</button>

      <div className="mt-7 border-t border-[#e5e3dd] pt-5">
        <p className="text-xs font-semibold">Friends holding {symbol}</p>

        {["Maya Chen", "Alex Johnson", "Jordan Lee"].map((friend, i) => (
          <div key={friend} className="mt-4 flex items-center justify-between">
            <span className="text-xs">{friend}</span>
            <span className="text-[10px] text-[#777872]">
              {[32, 21, 14][i]}%
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
