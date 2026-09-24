// components/fobs/portfolio-chart.tsx
//
// The portfolio performance area chart. Recharts, with the Fobs data-blue as
// the only colour — green/red are reserved for figures read from chain/oracle,
// never a chart fill. Fed a real value series; with too few points it shows the
// current value without inventing a line.

"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export type ChartPoint = { label: string; value: number };

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

export function PortfolioChart({
  series,
  totalValue,
  change,
  title = "Portfolio performance"
}: {
  series: ChartPoint[];
  totalValue: number | null;
  /** Percent change over the series window; null when unknown. */
  change?: number | null;
  title?: string;
}) {
  const hasSeries = series.length >= 2;

  return (
    <div className="fobs-surface p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium">{title}</p>

          <div className="mt-2 flex items-baseline gap-3">
            <h2 className="text-[26px] font-semibold tracking-[-0.04em]">
              {money(totalValue)}
            </h2>

            {change !== null && change !== undefined ? (
              <span
                className={`text-xs font-semibold ${
                  change >= 0 ? "text-[#23845b]" : "text-[#c94c4c]"
                }`}
              >
                {pct(change)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {hasSeries ? (
        <div className="h-[250px] w-full">
          <ResponsiveContainer>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
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
                fill="url(#portfolioFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-[250px] w-full items-center justify-center rounded-lg bg-[#f7f6f2] text-center text-xs text-[#85867f]">
          Not enough price history yet to chart performance.
        </div>
      )}
    </div>
  );
}
