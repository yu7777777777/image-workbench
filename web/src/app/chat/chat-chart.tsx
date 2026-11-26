const colors = ["#315e72", "#bc6e43", "#62754a", "#7b6590", "#227b76", "#a45161", "#7a642b", "#556884"];

export type ReplyChartData = {
  chartType: "bar" | "line" | "pie";
  rows: { name: string; values: number[] }[];
  series: string[];
  label: string;
  description?: string;
  min?: number;
};

export function ReplyChart({ chartType, rows, series, label, description, min = 0 }: ReplyChartData) {
  const values = rows.flatMap((row) => row.values);
  const low = Math.min(0, min, ...values);
  const high = Math.max(low + 1, ...values);
  const percent = (number: number) => (number - low) / (high - low) * 100;

  let total = 0;
  const slices = chartType === "pie" ? rows.filter(({ values }) => values[0] > 0).map((row, index) => {
    const start = total;
    total += row.values[0];
    return { ...row, start, end: total, color: colors[index % colors.length] };
  }) : [];

  return (
    <figure className="chat-widget-chart" aria-label={label}>
      {chartType === "pie" ? (
        total > 0 ? <div className="chat-chart-pie">
          <div className="chat-chart-disk" aria-hidden="true" style={{ background: `conic-gradient(${slices.map((slice) => `${slice.color} ${slice.start / total * 100}% ${slice.end / total * 100}%`).join(",")})` }} />
          <ul>{slices.map(({ name, values, color }, index) => <li key={index}><i style={{ background: color }} />{name} <strong>{values[0]}</strong></li>)}</ul>
        </div> : <p>暂无饼图数据</p>
      ) : chartType === "line" ? (
        <div className="chat-chart-line">
          <svg viewBox="0 0 480 144" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" x2="480" y1={132 - percent(0) * 1.2} y2={132 - percent(0) * 1.2} stroke="currentColor" opacity=".2" />
            {series.map((_, seriesIndex) => (
              <polyline key={seriesIndex} points={rows.map((row, index) => `${(index + 0.5) * 480 / rows.length},${132 - percent(row.values[seriesIndex]) * 1.2}`).join(" ")} fill="none" stroke={colors[seriesIndex]} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          <div className="chat-chart-bars">{rows.map(({ name, values }, index) => (
            <div key={index} className="chat-chart-column"><span>{name}</span><div>{values.map((value, seriesIndex) => <strong key={seriesIndex} title={series[seriesIndex]} style={{ color: colors[seriesIndex] }}>{value}</strong>)}</div></div>
          ))}</div>
        </div>
      ) : (
        <div className="chat-chart-bars">
          {rows.map(({ name, values }, index) => <div className="chat-chart-column" key={index}>
            <div className="chat-chart-track" aria-hidden="true">
              <span style={{ bottom: `${percent(0)}%` }} />
              {values.map((value, seriesIndex) => <i key={seriesIndex} style={{ left: `${12 + seriesIndex * 76 / series.length}%`, width: `${70 / series.length}%`, background: colors[seriesIndex], bottom: `${percent(Math.min(0, value))}%`, height: `${percent(Math.abs(value)) - percent(0)}%` }} />)}
            </div>
            <div>{values.map((value, seriesIndex) => <strong key={seriesIndex} title={series[seriesIndex]}>{value}</strong>)}<span>{name}</span></div>
          </div>)}
        </div>
      )}
      {chartType !== "pie" && series.length > 1 && <div className="chat-chart-legend">{series.map((name, index) => <span key={index}><i style={{ background: colors[index] }} />{name}</span>)}</div>}
      {description && <figcaption>{description}</figcaption>}
    </figure>
  );
}
