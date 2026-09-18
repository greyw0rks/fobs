import type { FeedTrade } from "@/lib/types";
import { ago, price } from "@/lib/format";

/**
 * The price of one asset, as the indexed trades saw it.
 *
 * No charting library and no price series table. The only prices this app
 * actually has are the ones recorded on trade receipts, so those are what is
 * plotted — a line drawn between two real trades, with nothing interpolated in
 * between and no candle invented for a period in which nobody traded. The gaps
 * are real and are left visible: the x axis is time, not trade index, so a quiet
 * week looks like a quiet week.
 *
 * The line is genuinely sparse, and a line through two points is a statement
 * about a trend that two points cannot support. Below `MIN_POINTS` this says so
 * instead of drawing one.
 *
 * A server component on purpose. This is static output from data the page
 * already has, so there is nothing for the client to hydrate and no reason to
 * ship a chart library for one polyline.
 */

/** Below this, a line implies a shape the data does not have. */
const MIN_POINTS = 3;

const W = 600;
const H = 180;
const PAD_X = 10;
const PAD_Y = 18;

export function PriceChart({ trades }: { trades: FeedTrade[] }) {
  const points = trades
    .filter((trade) => Number.isFinite(trade.price) && trade.price > 0)
    .map((trade) => ({ at: Date.parse(trade.tradedAt), price: trade.price, side: trade.side }))
    .sort((a, b) => a.at - b.at);

  if (points.length < MIN_POINTS) {
    return (
      <p className="muted">
        Not enough trades to chart yet — {points.length}{" "}
        {points.length === 1 ? "trade has" : "trades have"} been indexed for this
        asset, and a line needs at least {MIN_POINTS}. A chart drawn from fewer
        would be a shape the data does not support.
      </p>
    );
  }

  const prices = points.map((point) => point.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  // A flat series would divide by zero and draw nothing. Widen the band instead,
  // and centre the line it produces.
  const span = high - low || Math.max(high * 0.01, 0.01);
  const floor = high - low === 0 ? low - span / 2 : low;

  const first = points[0].at;
  const last = points[points.length - 1].at;
  const timeSpan = last - first;

  const x = (point: { at: number }, index: number) =>
    timeSpan === 0
      ? PAD_X + (index / (points.length - 1)) * (W - PAD_X * 2)
      : PAD_X + ((point.at - first) / timeSpan) * (W - PAD_X * 2);
  const y = (value: number) =>
    H - PAD_Y - ((value - floor) / span) * (H - PAD_Y * 2);

  const path = points.map((point, index) => `${x(point, index)},${y(point.price)}`).join(" ");

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`Price of ${points.length} indexed trades, from ${price(low)} to ${price(high)}`}
      >
        {/* Min and max, so the shape has a scale rather than just a direction. */}
        <line x1={0} y1={y(high)} x2={W} y2={y(high)} className="chart-grid" />
        <line x1={0} y1={y(low)} x2={W} y2={y(low)} className="chart-grid" />
        <polyline className="chart-line" points={path} />
        {points.map((point, index) => (
          <circle
            key={`${point.at}-${index}`}
            cx={x(point, index)}
            cy={y(point.price)}
            r={3}
            className={point.side === "sell" ? "chart-dot sell" : "chart-dot buy"}
          />
        ))}
      </svg>

      <figcaption className="muted">
        <span className="chip">{price(high)}</span> high ·{" "}
        <span className="chip">{price(low)}</span> low · {points.length} trades from{" "}
        {ago(new Date(points[0].at))} to {ago(new Date(points[points.length - 1].at))}.
        Plotted from indexed trade prices only — no candle is drawn for a period
        with no trades.
      </figcaption>
    </figure>
  );
}
