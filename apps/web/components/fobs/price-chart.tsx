// components/fobs/price-chart.tsx
//
// The per-stock price chart, with selectable timeframes. Same recharts area and
// Fobs data-blue as the portfolio chart, but fed the full ~1-year daily-close
// series and sliced client-side so the trader picks the window (1W…1Y) without
// a round trip. Only windows that actually contain two or more points render a
// button — our source is daily closes, so 1D (no intraday) simply won't appear
// until there is intraday data to back it.

"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { PricePoint } from "@/lib/server/price-history";

const DAY_MS = 86_400_000;

/** Timeframes offered, shortest first. `days` is the trailing window. */
const RANGES = [
  { key: "1D", days: 1 },
  { key: "1W", days: 7 },
  { key: "1M", days: 30 },
  { key: "3M", days: 90 },
  { key: "1Y", days: 365 }
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const digits = Math.abs(value) >= 1000 ? 0 : 2;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function PriceChart({
  points,
  currentPrice,
  title
}: {
  points: PricePoint[];
  currentPrice: number | null;
  title?: string;
}) {
  // The window is measured back from the newest point, not "now": a daily close
  // series ends at yesterday's close, so anchoring on the last point keeps the
  // short windows from coming up empty over a weekend.
  const anchor = points.length > 0 ? points[points.length - 1].at : Date.now();

  const windowFor = (days: number) =>
    points.filter((point) => point.at >= anchor - days * DAY_MS);

  // Only offer a timeframe that has two points to draw a line between.
  const available = RANGES.filter((range) => windowFor(range.days).length >= 2);

  // Default to 1M when it has data, else the widest window that does.
  const initial: RangeKey =
    available.find((range) => range.key === "1M")?.key ??
    available[available.length - 1]?.key ??
    "1M";

  const [active, setActive] = useState<RangeKey>(initial);
  const activeRange = RANGES.find((range) => range.key === active) ?? RANGES[2];

  const series = useMemo(() => {
    return windowFor(activeRange.days).map((point) => ({
      label: new Date(point.at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
      }),
      value: point.price
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, points]);

  const change =
    series.length >= 2 && series[0].value > 0
      ? ((series[series.length - 1].value - series[0].value) / series[0].value) * 100
      : null;

  return (
    <div className="fobs-surface p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          {title ? <p className="text-xs font-medium">{title}</p> : null}
          <div className="mt-2 flex items-baseline gap-3">
            <h2 className="text-[26px] font-semibold tracking-[-0.04em]">
              {money(currentPrice)}
            </h2>
            {change !== null ? (
              <span
                className={`text-xs font-semibold ${
                  change >= 0 ? "text-[#23845b]" : "text-[#c94c4c]"
                }`}
              >
                {pct(change)} · {active}
              </span>
            ) : null}
          </div>
        </div>

        {available.length > 1 ? (
          <div className="flex items-center gap-1 rounded-lg bg-[#f2f1ec] p-1">
            {available.map((range) => (
              <button
                key={range.key}
                type="button"
                onClick={() => setActive(range.key)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                  active === range.key
                    ? "bg-white text-[#111312] shadow-sm"
                    : "text-[#85867f] hover:text-[#111312]"
                }`}
              >
                {range.key}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="h-[250px] w-full">
        <ResponsiveContainer>
          <AreaChart data={series}>
            <defs>
              <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3175C6" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#3175C6" stopOpacity={0} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#999a93" }}
              minTickGap={24}
            />

            <YAxis
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#999a93" }}
              width={48}
              domain={["auto", "auto"]}
              tickFormatter={(value) => money(Number(value))}
            />

            <Tooltip formatter={(value) => money(Number(value))} />

            <Area
              type="monotone"
              dataKey="value"
              stroke="#3175C6"
              strokeWidth={2}
              fill="url(#priceFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
