import { useState } from "react";
import { Expand } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const colors = ["#2563eb", "#315b73", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#4b5563"];
const axisNumber = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 });

export type ReplyChartData = {
  chartType: "bar" | "line" | "pie" | "scatter";
  rows: { name: string; values: number[]; x?: number }[];
  series: string[];
  label: string;
  description?: string;
  min?: number;
};

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function scale(min: number, max: number) {
  const magnitude = Math.max(1, Math.abs(min), Math.abs(max));
  const low = min / magnitude;
  const high = max / magnitude;
  return (value: number) => high > low ? (value / magnitude - low) / (high - low) : 0.5;
}
export function ReplyChart({ chartType, rows: rawRows, series, label, description, min }: ReplyChartData) {
  const rows = rawRows.map((row) => ({
    name: row.name,
    x: toFiniteNumber(row.x),
    values: row.values.map((value) => toFiniteNumber(value) ?? 0),
  }));
  const minBound = toFiniteNumber(min);
  const [hidden, setHidden] = useState<number[]>([]);
  const [selected, setSelected] = useState<number>();
  const [hovered, setHovered] = useState<number>();
  const visible = series.map((_, index) => index).filter((index) => !hidden.includes(index));
  const values = rows.flatMap((row) => visible.map((index) => row.values[index]));
  const low = Math.min(0, minBound ?? 0, ...values);
  const rawHigh = Math.max(1, ...values);
  const high = chartType === "bar" && rawHigh > 0 ? rawHigh * 1.12 : rawHigh;
  const percent = scale(low, high);
  const positions = rows.map((row, index) => row.x ?? index);
  const xMin = Math.min(...positions);
  const xMax = Math.max(...positions);
  const xScale = scale(xMin, xMax);
  const x = (index: number) => chartType === "scatter" ? 18 + xScale(positions[index]) * 444 : (index + 0.5) * 480 / rows.length;
  const y = (number: number) => 132 - percent(number) * 112;
  const active = hovered ?? selected;
  const activeRow = active === undefined ? undefined : rows[active];

  function toggleSeries(index: number) {
    setHidden((current) => current.includes(index)
      ? current.filter((item) => item !== index)
      : current.length + 1 < series.length ? [...current, index] : current);
  }

  function select(index: number) {
    setSelected((current) => current === index ? undefined : index);
  }

  function focusPoint(index: number) {
    return {
      onPointerEnter: () => setHovered(index),
      onPointerLeave: () => setHovered(undefined),
      onFocus: () => setHovered(index),
      onBlur: () => setHovered(undefined),
    };
  }

  const pieTotal = chartType === "pie" ? rows.reduce((sum, row) => sum + (row.values[0] > 0 ? row.values[0] : 0), 0) : 0;
  let total = 0;
  const slices = chartType === "pie" ? rows.flatMap((row, index) => {
    if (!(row.values[0] > 0) || pieTotal <= 0) return [];
    const start = total;
    total += row.values[0] / pieTotal;
    return [{ ...row, index, start, end: total, pct: Math.round((row.values[0] / pieTotal) * 100), color: colors[index % colors.length] }];
  }) : [];

  const legend = chartType !== "pie" && series.length > 1 && (
    <div className="chat-chart-legend" aria-label="图例">
      {series.map((name, index) => <button type="button" key={index} onClick={() => toggleSeries(index)}
        aria-pressed={visible.includes(index)} disabled={visible.length === 1 && visible[0] === index}>
        <i style={{ background: colors[index] }} />{name}
      </button>)}
    </div>
  );

  function plot() {
    if (!rows.length) return <p className="chat-chart-empty">暂无符合条件的数据</p>;
    if (chartType === "pie") return total > 0 ? <div className="chat-chart-pie">
      <div className="chat-chart-disk" aria-hidden="true" style={{
        background: `conic-gradient(${slices.map((slice) => {
          const color = active === undefined || active === slice.index ? slice.color : `color-mix(in srgb, ${slice.color} 38%, var(--background))`;
          return `${color} ${slice.start / total * 100}% ${slice.end / total * 100}%`;
        }).join(",")})`,
      }}>
        <div className="chat-chart-donut-hole">
          <strong>{activeRow ? activeRow.values[0] : axisNumber.format(pieTotal)}</strong>
          <span>{activeRow ? activeRow.name : "总计"}</span>
        </div>
      </div>
      <ul>{slices.map(({ name, values: sliceValues, pct, color, index }) => <li key={index}>
        <button type="button" aria-pressed={selected === index} onClick={() => select(index)} {...focusPoint(index)}>
          <i style={{ background: color }} />{name} <strong>{sliceValues[0]}</strong> <span className="chat-chart-pct">{pct}%</span>
        </button>
      </li>)}</ul>
    </div> : <p className="chat-chart-empty">暂无饼图数据</p>;
    const xy = chartType === "line" || chartType === "scatter";
    const gradId = `chat-line-grad-${label.length}-${rows.length}`;
    const lineAreaPoints = chartType === "line" && visible.length && rows.length
      ? `${x(0)},136 ${rows.map((row, index) => `${x(index)},${y(row.values[visible[0]])}`).join(" ")} ${x(rows.length - 1)},136`
      : "";
    return (
      <div className={xy ? "chat-chart-line" : undefined}>
        {xy && <div className="chat-chart-axes">
          <div className="chat-chart-y-axis" aria-hidden="true">
            {[high, low / 2 + high / 2, low].map((tick, index) => <span key={index} style={{ top: `${y(tick) / 144 * 100}%` }}>{axisNumber.format(tick)}</span>)}
          </div>
          <div className="chat-chart-xy">
          <svg viewBox="0 0 480 144" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors[visible[0] ?? 0]} stopOpacity="0.18" />
              <stop offset="100%" stopColor={colors[visible[0] ?? 0]} stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {[high, low / 2 + high / 2, low].map((tick, index) =>
            <line key={index} x1="0" x2="480" y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeDasharray="3 4" opacity=".14" />)}
          {low < 0 && <line x1="0" x2="480" y1={y(0)} y2={y(0)} stroke="currentColor" opacity=".24" />}
          {lineAreaPoints && <polygon points={lineAreaPoints} fill={`url(#${gradId})`} />}
          {chartType === "line" && visible.map((seriesIndex) => (
            <polyline key={seriesIndex} points={rows.map((row, index) => `${x(index)},${y(row.values[seriesIndex])}`).join(" ")}
              fill="none" stroke={colors[seriesIndex]} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          ))}
          {visible.flatMap((seriesIndex) => rows.map((row, index) => (
            <ellipse key={`${seriesIndex}-${index}`} cx={x(index)} cy={y(row.values[seriesIndex])}
              rx={active === index ? 5.5 : chartType === "scatter" ? 4.2 : 2.8}
              ry={active === index ? 5 : chartType === "scatter" ? 3.8 : 2.5}
              fill={colors[seriesIndex]} stroke="var(--background)" strokeWidth="1.5"
              vectorEffect="non-scaling-stroke" onPointerEnter={() => setHovered(index)}
              onPointerLeave={() => setHovered(undefined)} onClick={() => select(index)} />
          )))}
          </svg>
          {chartType === "scatter" && <div className="chat-chart-x-axis" aria-hidden="true">
            {xMin === xMax ? <span>{axisNumber.format(xMin)}</span>
              : [xMin, xMin / 2 + xMax / 2, xMax].map((tick, index) => <span key={index}>{axisNumber.format(tick)}</span>)}
          </div>}
          </div>
        </div>}
        <div className="chat-chart-bars">{rows.map((row, index) => (
          <div className="chat-chart-column" key={index} data-active={active === index} {...focusPoint(index)}>
            {!xy && <div className="chat-chart-track" aria-hidden="true">
              {[0.25, 0.5, 0.75].map((ratio) => <em key={ratio} className="chat-chart-gridline" style={{ bottom: `${ratio * 100}%` }} />)}
              <span style={{ bottom: `${percent(0) * 100}%` }} />
              {visible.map((seriesIndex, order) => {
                const value = row.values[seriesIndex];
                const slotWidth = 64 / visible.length;
                const left = 18 + order * (68 / visible.length);
                return <i key={seriesIndex} style={{
                  left: `${left}%`, width: `min(${slotWidth}%, 36px)`,
                  background: colors[seriesIndex],
                  bottom: `${percent(Math.min(0, value)) * 100}%`,
                  height: `${Math.abs(percent(value) - percent(0)) * 100}%`,
                }} />;
              })}
            </div>}
            <button className="chat-chart-point" type="button" aria-pressed={selected === index} onClick={() => select(index)}>
              {visible.map((seriesIndex) => <strong key={seriesIndex} title={series[seriesIndex]} style={xy ? { color: colors[seriesIndex] } : undefined}>{row.values[seriesIndex]}</strong>)}
              <span>{row.name}</span>
            </button>
          </div>
        ))}</div>
      </div>
    );
  }

  const detail = activeRow && <p className="chat-chart-detail" role="status">
    <strong>{activeRow.name}</strong>{chartType === "scatter" && activeRow.x !== undefined && ` · X = ${activeRow.x}`}
    {visible.map((index) => ` · ${series[index]} ${activeRow.values[index]}`).join("")}
  </p>;

  return (
    <figure className="chat-widget-chart" aria-label={label}>
      <div className="chat-chart-heading">
        <strong>{label}</strong>
        <Dialog>
          <DialogTrigger asChild>
            <button type="button" className="chat-chart-expand"><Expand size={14} aria-hidden="true" />展开图表</button>
          </DialogTrigger>
          <DialogContent className="chat-chart-dialog">
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{description ?? "图表与数据"}</DialogDescription>
            {plot()}
            {legend}
            {detail}
            {!!rows.length && <div className="chat-chart-table"><table>
              <thead><tr><th scope="col">项目</th>{chartType === "scatter" && <th scope="col">X</th>}{visible.map((index) => <th scope="col" key={index}>{series[index]}</th>)}</tr></thead>
              <tbody>{rows.map((row, index) => <tr key={index}><th scope="row">{row.name}</th>{chartType === "scatter" && <td>{row.x}</td>}{visible.map((seriesIndex) => <td key={seriesIndex}>{row.values[seriesIndex]}</td>)}</tr>)}</tbody>
            </table></div>}
          </DialogContent>
        </Dialog>
      </div>
      {plot()}
      {legend}
      {detail}
      {description && <figcaption>{description}</figcaption>}
    </figure>
  );
}
