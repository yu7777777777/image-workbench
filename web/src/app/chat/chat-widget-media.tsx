import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import type { WidgetMarker } from "@/lib/chat-widget";

export function WidgetCarousel({ label, items, activeIndex, onChange, showArrows }: {
  label: string; items: ReactNode[]; activeIndex?: number; onChange?: (index: number) => void; showArrows: boolean;
}) {
  const [position, setPosition] = useState(0);
  const selected = activeIndex === undefined || !Number.isFinite(activeIndex) ? position : Math.trunc(activeIndex);
  const index = Math.max(0, Math.min(selected, items.length - 1));
  const show = onChange ?? setPosition;
  return <section className="chat-widget-carousel" aria-label={label} aria-roledescription="轮播">
    <div>{items[index]}</div>
    {items.length > 1 && <div className="chat-widget-carousel-controls">
      {showArrows && <button type="button" aria-label="上一项" disabled={!index} onClick={() => show(index - 1)}><ChevronLeft size={16} /></button>}
      <span aria-live="polite">{index + 1} / {items.length}</span>
      {showArrows && <button type="button" aria-label="下一项" disabled={index === items.length - 1} onClick={() => show(index + 1)}><ChevronRight size={16} /></button>}
    </div>}
  </section>;
}

function CoordinateMap({ point, showMap, toggle }: {
  point: Extract<WidgetMarker, { lat: number }>; showMap: boolean; toggle: () => void;
}) {
  const { lat, lon, label: pointName } = point;
  const area = [
    Math.max(-180, lon - 0.035), Math.max(-85, Math.min(85, lat) - 0.02),
    Math.min(180, lon + 0.035), Math.min(85, Math.max(-85, lat) + 0.02),
  ].join(",");
  const mapUrl = new URL("https://www.openstreetmap.org/export/embed.html");
  mapUrl.search = new URLSearchParams({ bbox: area, layer: "mapnik", marker: `${lat},${lon}` }).toString();
  const link = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=13/${lat}/${lon}`;
  return <>
    <span>{pointName} · {lat.toFixed(5)}, {lon.toFixed(5)}</span>
    {showMap && <iframe
      title={`${pointName}的地图`}
      src={mapUrl.href}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
    />}
    <div className="chat-widget-map-actions">
      <button type="button" aria-expanded={showMap} onClick={toggle}>{showMap ? "收起地图" : "查看地图"}</button>
      <a href={link} target="_blank" rel="noopener noreferrer">在 OpenStreetMap 中打开</a>
    </div>
  </>;
}

export function WidgetMap({ label, markers }: { label: string; markers: WidgetMarker[] }) {
  const [position, setPosition] = useState(0);
  const [showMap, setShowMap] = useState(false);
  const point = markers[Math.min(position, markers.length - 1)];
  return <section className="chat-widget-map" aria-label={label}>
    <div className="chat-widget-map-header"><MapPin size={17} aria-hidden="true" /><strong>{label}</strong></div>
    {markers.length > 1 && <label className="chat-widget-select">
      地图标记
      <select value={position} onChange={(event) => setPosition(Number(event.currentTarget.value))}>
        {markers.map((marker, index) => <option key={index} value={index}>{marker.label}</option>)}
      </select>
    </label>}
    {"address" in point ? <>
      <span>{point.address}</span>
      <div className="chat-widget-map-actions"><a href={`https://www.openstreetmap.org/search?${new URLSearchParams({ query: point.address })}`}
        target="_blank" rel="noopener noreferrer">在 OpenStreetMap 中查找地址</a></div>
    </> : <CoordinateMap point={point} showMap={showMap} toggle={() => setShowMap((current) => !current)} />}
  </section>;
}

export function WidgetVideo({ label, src }: { label: string; src?: string }) {
  const [error, setError] = useState(false);
  return <figure className="chat-widget-video" aria-label={label}>
    <figcaption>{label}</figcaption>
    {src && !error
      ? <video src={src} controls preload="none" playsInline aria-label={label} onError={() => setError(true)} />
      : <p>{error ? "视频暂时无法播放" : "视频地址未返回"}</p>}
  </figure>;
}
