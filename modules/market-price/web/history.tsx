import type { HistoryView } from "../contracts.ts";

/** Only observed dates receive points; gaps never receive invented/interpolated prices. */
export function HistoryPlot({ history }: { history: HistoryView }) {
  const points = history.data.filter((point) => point.median_price != null);
  if (!points.length)
    return (
      <p className="py-5 text-sm text-ink-3">
        {history.from} 至 {history.to} 暂无已核验历史报价。
      </p>
    );
  const values = points.flatMap((point) => [
    point.median_price!,
    point.reference_low ?? point.median_price!,
    point.reference_high ?? point.median_price!,
  ]);
  const min = Math.max(0, Math.min(...values) * 0.9),
    max = Math.max(min + 1, Math.max(...values) * 1.1);
  const from = Date.parse(history.from),
    span = Math.max(86400000, Date.parse(history.to) - from);
  const x = (date: string) => 60 + ((Date.parse(date) - from) / span) * 620;
  const y = (price: number) => 220 - ((price - min) / (max - min)) * 180;
  return (
    <div className="mb-4">
      <p className="mb-3 text-sm text-ink-3">
        元/斤 · 圆点为已核验样本中位数，竖线为足量样本的 P20–P80 区间。
        {history.notice}
      </p>
      <svg
        viewBox="0 0 740 270"
        role="img"
        aria-label={`${history.from} 至 ${history.to} 实际观测价格`}
        className="w-full max-w-4xl text-accent"
      >
        {[0, 1, 2, 3].map((index) => {
          const price = min + ((max - min) * index) / 3;
          return (
            <g key={index}>
              <line
                x1="60"
                x2="680"
                y1={y(price)}
                y2={y(price)}
                stroke="currentColor"
                opacity=".12"
              />
              <text
                x="50"
                y={y(price) + 4}
                textAnchor="end"
                fontSize="12"
                fill="currentColor"
              >
                {price.toFixed(2)}
              </text>
            </g>
          );
        })}
        {points.map((point) => (
          <g key={point.date}>
            <title>
              {point.date}：{point.median_price!.toFixed(2)} 元/斤，
              {point.sample_count} 个样本
            </title>
            {point.reference_low != null && point.reference_high != null && (
              <line
                x1={x(point.date)}
                x2={x(point.date)}
                y1={y(point.reference_low)}
                y2={y(point.reference_high)}
                stroke="currentColor"
                strokeWidth="3"
                opacity=".35"
              />
            )}
            <circle
              cx={x(point.date)}
              cy={y(point.median_price!)}
              r="4"
              fill="currentColor"
            />
          </g>
        ))}
        <text x="60" y="252" fontSize="12" fill="currentColor">
          {history.from}
        </text>
        <text
          x="680"
          y="252"
          textAnchor="end"
          fontSize="12"
          fill="currentColor"
        >
          {history.to}
        </text>
      </svg>
    </div>
  );
}
