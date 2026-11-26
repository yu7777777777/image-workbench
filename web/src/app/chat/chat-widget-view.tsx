import { createElement, useId, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Activity, Bell, BookOpen, Calendar, Camera, ChartLine, CheckCircle, Cloud, Code, Folder, Globe, Heart, House, Image as ImageIcon, Info, Mail, Minus, MousePointerClick, Plus, RotateCcw, Search, Settings, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { escapeReplyMarkdown } from "@/lib/chat-rich-reply";
import { widgetValue, type ChatWidget, type WidgetImage, type WidgetNode, type WidgetResourceType, type WidgetStateValue } from "@/lib/chat-widget";
import type { ChatResource } from "@/lib/chat-resources";
import { ReplyMarkdown } from "./chat-markdown";
import { ReplyChart } from "./chat-chart";
import { WidgetCarousel, WidgetMap, WidgetVideo } from "./chat-widget-media";
import { ChatWidgetImages } from "./chat-resource-view";

const icons = new Map([
  ["book-open", BookOpen],
  ["check-circle", CheckCircle],
  ["rotate-ccw", RotateCcw],
  ["globe", Globe],
  ["minus", Minus],
  ["plus", Plus],
  ["activity", Activity], ["bell", Bell], ["calendar", Calendar], ["camera", Camera], ["chart-line", ChartLine],
  ["cloud", Cloud], ["code", Code], ["folder", Folder], ["heart", Heart], ["home", House], ["image", ImageIcon],
  ["info", Info], ["mail", Mail], ["mouse-pointer-click", MousePointerClick], ["search", Search], ["settings", Settings],
  ["user", User], ["users", Users],
]);

const iconSizes = new Map([["xs", 13], ["sm", 15], ["lg", 19], ["xl", 22], ["2xl", 26], ["3xl", 32]]);

export function ChatWidgetView({ widget, streaming, canSend, onSend, renderResource, resolveImages }: {
  widget: ChatWidget;
  streaming: boolean;
  canSend: boolean;
  onSend: (text: string) => void;
  renderResource?: (type: WidgetResourceType, ref: string, fallback: string, key: string) => ReactNode;
  resolveImages: (node: WidgetImage) => ChatResource[];
}) {
  const id = useId();
  const [values, setValues] = useState(widget.initial);
  const setValue = (name: string, value: WidgetStateValue) => setValues((current) => new Map(current).set(name, value));
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

  const applyAction = (action: Extract<WidgetNode, { kind: "button" }>["action"]) => {
    if ("submit" in action) submit(action.submit);
    else if ("set" in action) {
      const { name, value } = action.set;
      setValues((current) => {
        const next = widgetValue(value, current);
        return typeof next === typeof widget.initial.get(name) && (typeof next !== "number" || Number.isFinite(next))
          ? new Map(current).set(name, next) : current;
      });
    } else if ("adjust" in action) {
      const { name, change, bound } = action.adjust;
      setValues((current) => {
        const next = Number(current.get(name)) + change;
        return new Map(current).set(name, change > 0 ? Math.min(bound, next) : Math.max(bound, next));
      });
    } else if ("reset" in action) {
      setValues((current) => {
        const next = new Map(current);
        for (const name of action.reset) {
          const initial = widget.initial.get(name);
          if (initial !== undefined) next.set(name, initial);
        }
        return next;
      });
    }
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
          flex: options?.flex === undefined ? undefined : `${options.flex} 1 12rem`,
          alignItems: options?.align,
          justifyContent: options?.justify === "between" ? "space-between" : options?.justify,
          padding: options?.padding,
          minHeight: options?.height === "100%" ? undefined : options?.height,
          height: options?.height === "100%" ? "100%" : undefined,
          aspectRatio: options?.aspectRatio,
          flexWrap: options?.wrap ? "wrap" : undefined,
          fontVariantNumeric: options?.numeric ? "tabular-nums" : undefined,
        } satisfies CSSProperties & { "--chat-widget-columns"?: number };
        const color = options?.color === undefined ? undefined : widgetValue(options.color, values);
        return <div className={`chat-widget-${node.variant}`} data-border={options?.border} data-surface={options?.surface}
          data-color={typeof color === "string" ? color.slice(0, 24) : undefined} data-size={options?.size} style={style} key={key}>
          {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
        </div>;
      }
      case "form":
        return <form className="chat-widget-form" aria-label={node.label} onSubmit={(event) => submitForm(event, node.submit)} key={key}>
          {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
        </form>;
      case "popover": {
        const Icon = node.icon ? icons.get(node.icon) : undefined;
        return <details className="chat-widget-popover" key={key}>
          <summary>{Icon && <Icon size={15} aria-hidden="true" />}{node.label}</summary>
          <div>{node.children.map((child, index) => renderNode(child, `${key}-${index}`))}</div>
        </details>;
      }
      case "carousel": {
        const binding = node.binding;
        return <WidgetCarousel label={node.label} key={key} showArrows={node.showArrows}
          activeIndex={binding ? Number(values.get(binding)) : undefined}
          onChange={binding ? (index) => setValue(binding, index) : undefined}
          items={node.children.map((child, index) => renderNode(child, `${key}-${index}`))} />;
      }
      case "pressable": {
        const { action, options } = node;
        const value = "set" in action ? values.get(action.set.name) : undefined;
        return <div key={key} className="chat-widget-pressable" data-border={options.border} style={{ padding: options.padding, gap: options.gap }}>
          {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
          <button type="button" disabled={streaming || ("submit" in action && !canSend)} aria-label={node.label}
            aria-pressed={typeof value === "boolean" ? value : undefined} onClick={() => applyAction(action)} />
        </div>;
      }
      case "map":
        return <WidgetMap label={node.label} markers={node.markers} key={key} />;
      case "video":
        return <WidgetVideo label={node.label} src={node.src} key={key} />;
      case "icon": {
        const Icon = icons.get(node.name);
        return Icon ? <Icon key={key} size={iconSizes.get(node.size ?? "") ?? 15} aria-hidden="true" /> : null;
      }
      case "divider":
        return <hr key={key} />;
      case "spacer":
        return <span className="chat-widget-spacer" key={key} aria-hidden="true" />;
      case "unsupported":
        return <details className="chat-widget-unsupported" key={key}>
          <summary>此组件暂无法显示</summary><pre>{`<${node.tag}>${node.text}</${node.tag}>`}</pre>
        </details>;
      case "svg":
        return <svg className="chat-widget-svg" key={key} role="img" aria-label="矢量图" viewBox={node.viewBox}>
          {node.shapes.map(({ tag, attrs }, index) => createElement(tag, { ...attrs, key: index }))}
        </svg>;
      case "list": {
        const List = node.ordered ? "ol" : "ul";
        return <List className="chat-widget-list" data-connected={node.connected} style={{ gap: node.gap }} key={key}>
          {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
        </List>;
      }
      case "list-item":
        return <li className="chat-widget-list-item" key={key}>{node.children.map((child, index) => renderNode(child, `${key}-${index}`))}</li>;
      case "radio":
        return (
          <fieldset key={key} className={node.segmented ? "chat-widget-options chat-widget-segmented" : "chat-widget-options"} data-horizontal={node.horizontal} disabled={streaming}>
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
        return (node.ref && renderResource?.(node.resourceType, node.ref, node.label, key))
          || <span key={key} className="chat-unavailable-link">{node.label}</span>;
      case "image":
        return <ChatWidgetImages key={key} node={node} images={node.href
          ? [{ id: node.href, type: "image", title: node.label, imageUrl: node.href }]
          : resolveImages(node)} />;
      case "checkbox": {
        const current = values.get(node.name);
        const item = node.item;
        return <label className="chat-widget-checkbox" key={key}>
          <input type="checkbox" checked={item === undefined ? current === true : Array.isArray(current) && current.includes(item)} disabled={streaming} onChange={(event) => {
            const checked = event.currentTarget.checked;
            if (item === undefined) setValue(node.name, checked);
            else setValues((previous) => {
              const collection = previous.get(node.name);
              if (!Array.isArray(collection)) return previous;
              const remaining = collection.filter((selected) => selected !== item);
              return new Map(previous).set(node.name, checked ? [...remaining, item] : remaining);
            });
          }} />
          {node.label}
        </label>;
      }
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
            ? <textarea {...props} rows={node.rows ?? 3} maxLength={node.maxLength} onChange={(event) => setValue(node.name, event.currentTarget.value)} />
            : <input {...props} type={node.inputType} min={node.min} max={node.max} maxLength={node.maxLength} onChange={(event) => {
              const input = event.currentTarget;
              setValue(node.name, typeof widget.initial.get(node.name) === "number" && Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : input.value);
            }} />}
        </label>;
      }
      case "button": {
        const { action } = node;
        const sends = "submit" in action || "submitForm" in action;
        return (
          <Button key={key} type={"submitForm" in action ? "submit" : "button"} data-chat-submit={"submit" in action ? "" : undefined}
            aria-label={node.label} variant={sends || ("set" in action && !node.style) ? "default" : "outline"}
            data-widget-color={node.color}
            disabled={streaming || (sends && !canSend) || ("adjust" in action && Number(values.get(action.adjust.name)) === action.adjust.bound)}
            onClick={(event) => {
              if (!("submit" in action) || event.currentTarget.form?.reportValidity() !== false) applyAction(action);
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
