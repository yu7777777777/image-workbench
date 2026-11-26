import { useId, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { BookOpen, CheckCircle, Globe, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { escapeReplyMarkdown } from "@/lib/chat-rich-reply";
import { widgetValue, type ChatWidget, type WidgetNode, type WidgetResourceType } from "@/lib/chat-widget";
import { ReplyMarkdown } from "./chat-markdown";
import { ReplyChart } from "./chat-chart";
import { WidgetCarousel, WidgetMap, WidgetVideo } from "./chat-widget-media";

const icons = new Map([
  ["book-open", BookOpen],
  ["check-circle", CheckCircle],
  ["rotate-ccw", RotateCcw],
  ["globe", Globe],
  ["minus", Minus],
  ["plus", Plus],
]);

export function ChatWidgetView({ widget, streaming, canSend, onSend, renderResource }: {
  widget: ChatWidget;
  streaming: boolean;
  canSend: boolean;
  onSend: (text: string) => void;
  renderResource?: (type: WidgetResourceType, ref: string, fallback: string, key: string) => ReactNode;
}) {
  const id = useId();
  const [values, setValues] = useState(widget.initial);
  const setValue = (name: string, value: string | number | boolean) => setValues((current) => new Map(current).set(name, value));
  const submit = (value: Parameters<typeof widgetValue>[0]) => {
    if (!canSend || streaming) return;
    const message = String(widgetValue(value, values)).trim();
    if (message) onSend(message);
  };
  const submitForm = (event: FormEvent<HTMLFormElement>, value?: Parameters<typeof widgetValue>[0]) => {
    event.preventDefault();
    if (value !== undefined) submit(value);
    else event.currentTarget.querySelector<HTMLButtonElement>("button[data-chat-submit]")?.click();
  };

  function renderNode(node: WidgetNode, key: string): ReactNode {
    switch (node.kind) {
      case "markdown": {
        const text = node.parts.map((part) => typeof part === "string" ? part : escapeReplyMarkdown(String(widgetValue(part.value, values)))).join("");
        return <div className="chat-widget-markdown" key={key}><ReplyMarkdown text={text} /></div>;
      }
      case "layout": {
        const options = node.options;
        const style = {
          ...(options?.gap === undefined ? {} : { gap: options.gap }),
          ...(options?.columns === undefined ? {} : { "--chat-widget-columns": options.columns }),
          alignItems: options?.align,
          justifyContent: options?.justify === "between" ? "space-between" : options?.justify,
        } satisfies CSSProperties & { "--chat-widget-columns"?: number };
        return <div className={`chat-widget-${node.variant}`} data-border={options?.border} style={style} key={key}>
          {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
        </div>;
      }
      case "form":
        return <form className="chat-widget-form" aria-label={node.label} onSubmit={(event) => submitForm(event, node.submit)} key={key}>
          {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
        </form>;
      case "popover":
        return <details className="chat-widget-popover" key={key}>
          <summary>{node.label}</summary>
          <div>{node.children.map((child, index) => renderNode(child, `${key}-${index}`))}</div>
        </details>;
      case "carousel":
        return <WidgetCarousel label={node.label} key={key} items={node.children.map((child, index) => renderNode(child, `${key}-${index}`))} />;
      case "map":
        return <WidgetMap label={node.label} markers={node.markers} key={key} />;
      case "video":
        return <WidgetVideo label={node.label} src={node.src} key={key} />;
      case "icon": {
        const Icon = icons.get(node.name);
        return Icon ? <Icon key={key} size={15} aria-hidden="true" /> : null;
      }
      case "divider":
        return <hr key={key} />;
      case "radio":
        return (
          <fieldset key={key} className={node.segmented ? "chat-widget-options chat-widget-segmented" : "chat-widget-options"} disabled={streaming}>
            <legend>{node.label}</legend>
            <div>
              {node.options.map((option) => (
                <label key={option.value}>
                  <input type="radio" name={`${id}-${key}-${node.name}`} value={option.value} checked={values.get(node.name) === option.value} onChange={() => setValue(node.name, option.value)} />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        );
      case "slider":
        return (
          <input
            key={key}
            className="chat-widget-slider"
            type="range"
            aria-label={`调整 ${node.name.toUpperCase()}`}
            min={node.min}
            max={node.max}
            step={node.step}
            value={Number(values.get(node.name))}
            disabled={streaming}
            onChange={(event) => setValue(node.name, event.currentTarget.valueAsNumber)}
          />
        );
      case "chart": {
        const filter = node.filter === undefined ? undefined : widgetValue(node.filter, values);
        const rows = node.rows.filter((row) => filter === undefined || row.filter === filter);
        return <ReplyChart key={key} chartType={node.chartType} label={node.label} series={node.series} description={node.description} min={node.min} rows={rows.map(({ name, x, values: rowValues }) => ({
          name: String(widgetValue(name, values)),
          x: x === undefined ? undefined : Number(widgetValue(x, values)),
          values: rowValues.map((value) => {
            const number = Number(widgetValue(value, values));
            return Number.isFinite(number) ? number : 0;
          }),
        }))} />;
      }
      case "condition":
        return <div className="chat-widget-condition" key={key}>{(widgetValue(node.test, values) ? node.children : node.fallback).map((child, index) => renderNode(child, `${key}-${index}`))}</div>;
      case "link":
        return node.href ? <a key={key} href={node.href} target="_blank" rel="noopener noreferrer">{node.label}</a>
          : (node.ref && renderResource?.(node.product ? "product" : "source", node.ref, node.label, key))
            || <span key={key} className="chat-unavailable-link">{node.label}（来源链接未返回）</span>;
      case "resource":
        return node.href ? <img key={key} className="chat-widget-image" src={node.href} alt={node.label === "图片未返回" ? "" : node.label} loading="lazy" referrerPolicy="no-referrer" />
          : (node.ref && renderResource?.(node.resourceType, node.ref, node.label, key))
            || <span key={key} className="chat-unavailable-link">{node.label}</span>;
      case "checkbox":
        return <label className="chat-widget-checkbox" key={key}>
          <input type="checkbox" checked={values.get(node.name) === true} disabled={streaming} onChange={(event) => setValue(node.name, event.currentTarget.checked)} />
          {node.label}
        </label>;
      case "select":
        return <label className="chat-widget-select" key={key}>
          {node.label}
          <select value={String(values.get(node.name))} disabled={streaming} onChange={(event) => setValue(node.name, event.currentTarget.value)}>
            {node.options.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>;
      case "input": {
        const props = {
          value: String(values.get(node.name) ?? ""),
          disabled: streaming,
          required: node.required,
          placeholder: node.placeholder,
        };
        return <label className="chat-widget-field" key={key}>
          <span>{node.label}</span>
          {node.inputType === "textarea"
            ? <textarea {...props} rows={3} maxLength={node.maxLength} onChange={(event) => setValue(node.name, event.currentTarget.value)} />
            : <input {...props} type={node.inputType} min={node.min} max={node.max} maxLength={node.maxLength} onChange={(event) => setValue(node.name, event.currentTarget.value)} />}
        </label>;
      }
      case "button": {
        const { action } = node;
        const sends = "submit" in action || "submitForm" in action;
        return (
          <Button key={key} type={"submitForm" in action ? "submit" : "button"} data-chat-submit={"submit" in action ? "" : undefined}
            aria-label={node.label} variant={sends ? "default" : "outline"}
            disabled={streaming || (sends && !canSend) || ("adjust" in action && Number(values.get(action.adjust.name)) === action.adjust.bound)}
            onClick={(event) => {
              if ("submit" in action) {
                if (event.currentTarget.form?.reportValidity() !== false) submit(action.submit);
              } else if ("adjust" in action) {
                const {name, change, bound} = action.adjust;
                setValues((current) => {
                  const next = Number(current.get(name)) + change;
                  return new Map(current).set(name, change > 0 ? Math.min(bound, next) : Math.max(bound, next));
                });
              } else if ("reset" in action) {
                setValues((current) => {
                  const next = new Map(current);
                  for (const name of action.reset) next.set(name, widget.initial.get(name)!);
                  return next;
                });
              }
            }}>
            {node.children.map((child, index) => child.kind === "markdown"
              ? <span key={index}>{child.parts.map((part) => typeof part === "string" ? part : widgetValue(part.value, values)).join("")}</span>
              : renderNode(child, `${key}-${index}`))}
          </Button>
        );
      }
    }
  }

  const contents = renderNode(widget.root, "widget");
  return widget.form && !widget.explicitForm
    ? <form className="chat-widget chat-reply-form" onSubmit={(event) => submitForm(event)}>
      {contents}
      <button type="submit" hidden disabled={streaming || !canSend} />
    </form>
    : <div className="chat-widget">{contents}</div>;
}
