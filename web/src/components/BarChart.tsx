export type BarDatum = {
  label: string;
  /** `null` draws no bar and reads "no data". */
  value: number | null;
  text: string;
};

type Props = {
  title: string;
  /** Names what the bar length shows, drawn under the horizontal axis. */
  valueAxisLabel: string;
  /** Names what each row is, drawn beside the vertical axis. */
  categoryAxisLabel: string;
  data: readonly BarDatum[];
  /** Fixed top of the axis (for example 1 for a rate). Defaults to the largest value. */
  max?: number;
  formatTick?: (value: number) => string;
};

const WIDTH = 640;
const ROW = 28;
const LEFT = 170;
const RIGHT = 70;
const TOP = 8;
const AXIS = 52;
const TICKS = 4;

function clip(label: string): string {
  return label.length > 24 ? `${label.slice(0, 23)}...` : label;
}

/** A small dependency-free horizontal bar chart. The table beside it carries the same numbers. */
export function BarChart({ title, valueAxisLabel, categoryAxisLabel, data, max, formatTick }: Props) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value ?? 0));
  const plot = WIDTH - LEFT - RIGHT;
  const height = TOP + data.length * ROW + AXIS;
  const summary = data.map((d) => `${d.label}: ${d.value === null ? "no data" : d.text}`).join("; ");

  return (
    <figure className="bar-chart">
      <figcaption>{title}</figcaption>
      <svg
        role="img"
        aria-label={`${title}. ${summary}`}
        viewBox={`0 0 ${WIDTH} ${height}`}
        width="100%"
        preserveAspectRatio="xMinYMin meet"
      >
        {Array.from({ length: TICKS + 1 }, (_, i) => {
          const value = (top * i) / TICKS;
          const x = LEFT + (plot * i) / TICKS;
          return (
            <g key={i} aria-hidden="true">
              <line x1={x} x2={x} y1={TOP} y2={TOP + data.length * ROW} className="bar-chart-grid" />
              <text x={x} y={TOP + data.length * ROW + 16} textAnchor="middle" className="bar-chart-tick">
                {formatTick ? formatTick(value) : String(Math.round(value * 100) / 100)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const y = TOP + i * ROW;
          const barWidth = d.value === null ? 0 : Math.max(0, Math.min(1, d.value / top)) * plot;
          return (
            <g key={`${d.label}-${i}`} aria-hidden="true">
              <text x={LEFT - 8} y={y + ROW / 2 + 4} textAnchor="end" className="bar-chart-label">
                {clip(d.label)}
              </text>
              <rect x={LEFT} y={y + 4} width={barWidth} height={ROW - 8} className="bar-chart-bar" />
              <text x={LEFT + barWidth + 6} y={y + ROW / 2 + 4} className="bar-chart-value">
                {d.value === null ? "no data" : d.text}
              </text>
            </g>
          );
        })}
        <text x={LEFT + plot / 2} y={height - 8} textAnchor="middle" className="bar-chart-axis-title">
          {valueAxisLabel}
        </text>
        <text
          transform={`translate(12 ${TOP + (data.length * ROW) / 2}) rotate(-90)`}
          textAnchor="middle"
          className="bar-chart-axis-title"
        >
          {categoryAxisLabel}
        </text>
      </svg>
    </figure>
  );
}
