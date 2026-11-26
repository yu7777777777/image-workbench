import { createElement, useId, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  Activity, Bell, BookOpen, Calendar, Camera, ChartColumn, ChartLine, Check, CheckCircle,
  ChevronDown, ChevronRight, ChevronUp, Circle, Cloud, Code, CornerDownRight, FileText,
  Folder, Globe, Heart, House, Image as ImageIcon, Info, LayoutDashboard, LoaderCircle,
  Mail, Minus, MousePointerClick, Plus, Power, RotateCcw, Search, Settings, ShoppingBag,
  Trash2, User, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { escapeReplyMarkdown } from "@/lib/chat-rich-reply";
import { applyWidgetArrayAction, widgetValue, type ChatWidget, type WidgetImage, type WidgetNode, type WidgetResourceType, type WidgetStateValue } from "@/lib/chat-widget";
import type { ChatResource } from "@/lib/chat-resources";
import { CodeBlock, ReplyMarkdown } from "./chat-markdown";
import { ReplyChart } from "./chat-chart";
import { WidgetCarousel, WidgetMap, WidgetVideo } from "./chat-widget-media";
import { ChatWidgetImages } from "./chat-resource-view";

const icons = new Map([
  ["book-open", BookOpen],
  ["check-circle", CheckCircle],
  ["check-circle-2", CheckCircle],
  ["circle-check", CheckCircle],
  ["rotate-ccw", RotateCcw],
  ["globe", Globe],
  ["minus", Minus],
  ["plus", Plus],
  ["activity", Activity], ["bell", Bell], ["calendar", Calendar], ["camera", Camera], ["chart-line", ChartLine],
  ["cloud", Cloud], ["code", Code], ["folder", Folder], ["heart", Heart], ["home", House], ["image", ImageIcon],
  ["info", Info], ["mail", Mail], ["mouse-pointer-click", MousePointerClick], ["search", Search], ["settings", Settings],
  ["user", User], ["users", Users],
  ["check", Check], ["chevron-down", ChevronDown], ["chevron-right", ChevronRight], ["chevron-up", ChevronUp],
  ["circle", Circle], ["corner-down-right", CornerDownRight], ["file-text", FileText], ["chart-column", ChartColumn],
  ["layout-dashboard", LayoutDashboard],
  ["power", Power], ["shopping-bag", ShoppingBag], ["trash-2", Trash2],
]);

const iconLabels = new Map([
  ["plus", "添加"], ["search", "搜索"], ["settings", "设置"], ["trash-2", "删除"], ["heart", "收藏"],
]);

const iconSizes = new Map([["xs", 13], ["sm", 15], ["lg", 19], ["xl", 22], ["2xl", 26], ["3xl", 32]]);
const layoutRadii = { md: 7, lg: 10, xl: 14, "2xl": 18, full: 999 };
type WidgetLayoutOptions = Extract<WidgetNode, { kind: "layout" }>["options"];

function layoutStyle(options: WidgetLayoutOptions, verticalGrid = false): CSSProperties & { "--chat-widget-columns"?: number } {
  const padding = options?.padding;
  const inset = typeof padding === "object" || options?.square !== undefined ? 0 : undefined;
  const justify = options?.justify === "between" ? "space-between" : options?.justify;
  const flexBasis = options?.border || options?.surface || options?.background ? "12rem" : "0px";
  return {
    gap: options?.gap,
    "--chat-widget-columns": options?.columns,
    flex: options?.flex === undefined ? undefined : `${options.flex} 1 ${flexBasis}`,
    alignItems: verticalGrid ? undefined : options?.align,
    justifyItems: verticalGrid ? options?.align : undefined,
    alignContent: verticalGrid ? justify : undefined,
    justifyContent: verticalGrid ? undefined : justify,
    paddingTop: (typeof padding === "object" ? padding.top : padding) ?? inset,
    paddingRight: (typeof padding === "object" ? padding.right : padding) ?? inset,
    paddingBottom: (typeof padding === "object" ? padding.bottom : padding) ?? inset,
    paddingLeft: (typeof padding === "object" ? padding.left : padding) ?? inset,
    borderRadius: options?.radius === undefined ? undefined : layoutRadii[options.radius],
    inlineSize: options?.square,
    blockSize: options?.square,
    minHeight: options?.height === "100%" ? undefined : options?.height,
    height: options?.height === "100%" ? "100%" : undefined,
    aspectRatio: options?.aspectRatio,
    flexWrap: options?.wrap ? "wrap" : undefined,
    fontVariantNumeric: options?.numeric ? "tabular-nums" : undefined,
  };
}

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
  const root = useMemo(() => values === widget.initial ? widget.root : widget.compileForState?.(values) ?? widget.root, [widget, values]);
  type WidgetAction = Extract<WidgetNode, { kind: "button" }>["action"];
  type Update = Extract<WidgetAction, { updates: unknown }>["updates"][number];
  const applyUpdates = (current: Map<string, WidgetStateValue>, updates: Update[]) => {
    const next = new Map(current);
    for (const { name, value } of updates) {
      const resolved = widgetValue(value, current);
      if (typeof resolved === typeof widget.initial.get(name) && (typeof resolved !== "number" || Number.isFinite(resolved))) {
        next.set(name, resolved);
      }
    }
    return next;
  };
  const setValue = (name: string, value: WidgetStateValue, updates: Update[] = []) => setValues((current) => {
    const next = new Map(current).set(name, value);
    return updates.length ? applyUpdates(next, updates) : next;
  });
  const submit = (value: Parameters<typeof widgetValue>[0]) => {
    if (!canSend || streaming) return;
    const message = String(widgetValue(value, values)).trim();
    if (message) onSend(message);
  };
  const submitForm = (event: FormEvent<HTMLFormElement>, value?: Parameters<typeof widgetValue>[0], action?: WidgetAction) => {
    event.preventDefault();
    if (streaming) return;
    if (value !== undefined) submit(value);
    else if (action) applyAction(action);
    else event.currentTarget.querySelector<HTMLButtonElement>("button[data-chat-submit]")?.click();
  };

  const applyAction = (action: WidgetAction) => {
    if ("submit" in action) submit(action.submit);
    else if ("set" in action) setValues((current) => applyUpdates(current, [action.set]));
    else if ("updates" in action && action.updates.length) setValues((current) => applyUpdates(current, action.updates));
    else if ("array" in action) {
      setValues((current) => {
        const next = applyWidgetArrayAction(action.array, current);
        return next === undefined ? current : new Map(current).set(action.array.name, next);
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

  function resolveText(value: Parameters<typeof widgetValue>[0] | undefined): string | undefined {
    if (value === undefined) return undefined;
    const result = widgetValue(value, values);
    return typeof result === "string" ? result.slice(0, 24) : undefined;
  }

  function renderNode(node: WidgetNode, key: string): ReactNode {
    switch (node.kind) {
      case "markdown": {
        const text = node.parts.map((part) => typeof part === "string" ? part : escapeReplyMarkdown(String(widgetValue(part.value, values)))).join("");
        return <div className="chat-widget-markdown" key={key}><ReplyMarkdown text={text} /></div>;
      }
      case "layout": {
        const options = node.options;
        const verticalGrid = node.variant === "box" || node.variant === "col" || node.variant === "card" || node.variant === "callout";
        const style = layoutStyle(options, verticalGrid);
        const Container = node.variant === "blockquote" ? "blockquote" : "div";
        return <Container className={`chat-widget-${node.variant}`} data-border={options?.border} data-surface={options?.surface}
          data-background={resolveText(options?.background)} data-color={resolveText(options?.color)} data-size={options?.size}
          data-flex={options?.flex !== undefined || undefined} data-square={options?.square !== undefined || undefined} style={style} key={key}>
          {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
        </Container>;
      }
      case "form":
        return <form className="chat-widget-form" aria-label={node.label} onSubmit={(event) => submitForm(event, node.submit, node.action)} key={key}>
          {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
        </form>;
      case "popover": {
        const Icon = node.icon ? icons.get(node.icon) : ChevronDown;
        const trailing = !node.icon || node.icon === "chevron-down";
        const glyph = Icon && <Icon size={15} aria-hidden="true" className={trailing ? "chat-widget-popover-chevron" : undefined} />;
        return <Popover key={key}>
          <PopoverTrigger asChild><Button variant="outline" size="sm" className="chat-widget-popover-trigger" disabled={streaming}>
            {!trailing && glyph}{node.label}{trailing && glyph}
          </Button></PopoverTrigger>
          <PopoverContent align="start" sideOffset={7} aria-label={node.label} className="chat-markdown chat-widget chat-widget-popover-content">
            {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
          </PopoverContent>
        </Popover>;
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
        const value = node.pressed !== undefined ? widgetValue(node.pressed, values) : "set" in action ? values.get(action.set.name) : undefined;
        const expanded = node.expanded === undefined ? undefined : Boolean(widgetValue(node.expanded, values));
        return <div key={key} className="chat-widget-pressable" data-border={options.border} data-background={resolveText(options.background)}
          style={layoutStyle(options, true)}>
          {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
          <button type="button" disabled={streaming || ("submit" in action && !canSend)} aria-label={node.label}
            aria-expanded={expanded} aria-pressed={expanded === undefined && typeof value === "boolean" ? value : undefined}
            onClick={() => applyAction(action)} />
        </div>;
      }
      case "map":
        return <WidgetMap label={node.label} markers={node.markers} key={key} />;
      case "video":
        return <WidgetVideo label={node.label} src={node.src} key={key} />;
      case "icon": {
        const Icon = icons.get(String(widgetValue(node.name, values)));
        return Icon ? <Icon key={key} size={iconSizes.get(node.size ?? "") ?? 15} aria-hidden="true" data-color={resolveText(node.color)} /> : null;
      }
      case "divider":
        return <hr key={key} />;
      case "spacer":
        return <span className="chat-widget-spacer" key={key} aria-hidden="true" />;
      case "unsupported":
        return <details className="chat-widget-unsupported" key={key}>
          <summary>此组件暂无法显示</summary><pre>{node.source ?? `<${node.tag}>${node.text}</${node.tag}>`}</pre>
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
      case "table":
        return <div className="chat-widget-table" tabIndex={0} role="region" aria-label={node.label ?? "数据表格"} key={key}>
          <table aria-label={node.label}>
            {node.children.length > 1 && <thead>{renderTableRow(node.children[0], `${key}-head`, true)}</thead>}
            <tbody>{node.children.slice(node.children.length > 1 ? 1 : 0).map((child, index) => renderTableRow(child, `${key}-${index}`))}</tbody>
          </table>
          {node.unsupportedRepeats?.map((child, index) => renderNode(child, `${key}-unsupported-${index}`))}
        </div>;
      case "table-row":
      case "table-cell":
        return null;
      case "math":
        return <div className="chat-widget-markdown" key={key}>
          <ReplyMarkdown text={node.inline ? `$${node.latex}$` : `$$\n${node.latex}\n$$`} />
        </div>;
      case "code":
        return <CodeBlock key={key} streaming={streaming}><code className={node.language ? `language-${node.language}` : undefined}>{node.source}</code></CodeBlock>;
      case "progress":
        return <progress className="chat-widget-progress" key={key} aria-label={node.label} max={node.max}
          value={Math.max(0, Math.min(node.max, Number(widgetValue(node.value, values)) || 0))} />;
      case "radio":
        return (
          <fieldset key={key} className={node.segmented ? "chat-widget-options chat-widget-segmented" : "chat-widget-options"} data-horizontal={node.horizontal} data-block={node.block} disabled={streaming}>
            <legend>{node.label}</legend>
            <div>
              {node.options.map((option) => (
                <label key={option.value}>
                  <input type="radio" name={`${id}-${key}-${node.name}`} value={option.value} checked={String(values.get(node.name)) === option.value} required={node.required}
                    onChange={() => setValue(node.name, node.numeric ? Number(option.value) : option.value, node.updates)} />
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
      case "condition": {
        const children = widgetValue(node.test, values) ? node.children : node.fallback;
        return children.length ? <div className="chat-widget-condition" key={key}>{children.map((child, index) => renderNode(child, `${key}-${index}`))}</div> : null;
      }
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
        const { item, index } = node;
        const initial = Array.isArray(current) ? (index === undefined ? current.includes(item) : current[index] === true) : current === true;
        return <label className="chat-widget-checkbox" data-switch={node.switch} data-compact={node.compact} key={key}>
          <input type="checkbox" role={node.switch ? "switch" : undefined} aria-label={node.compact ? node.label : undefined}
            checked={initial} disabled={streaming} onChange={(event) => {
            const checked = event.currentTarget.checked;
            if (item === undefined && index === undefined) setValue(node.name, checked);
            else setValues((previous) => {
              const collection = previous.get(node.name);
              if (!Array.isArray(collection)) return previous;
              if (index !== undefined) {
                return new Map(previous).set(node.name, collection.map((value, position) => position === index ? checked : value));
              }
              const remaining = collection.filter((selected) => selected !== item);
              return new Map(previous).set(node.name, checked && item !== undefined ? [...remaining, item] : remaining);
            });
          }} />
          {!node.compact && node.label}
        </label>;
      }
      case "select":
        return <label className="chat-widget-select" key={key}>
          {node.label}
          <select value={String(values.get(node.name))} disabled={streaming} onChange={(event) => setValue(node.name, event.currentTarget.value, node.updates)}>
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
            ? <textarea {...props} rows={node.rows ?? 3} maxLength={node.maxLength} onChange={(event) => setValue(node.name, event.currentTarget.value, node.updates)} />
            : <input {...props} type={node.inputType} min={node.min} max={node.max} maxLength={node.maxLength} onChange={(event) => {
              const input = event.currentTarget;
              setValue(node.name, typeof widget.initial.get(node.name) === "number" && Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : input.value, node.updates);
            }} />}
        </label>;
      }
      case "button": {
        const { action } = node;
        const sends = "submit" in action;
        const color = node.color === undefined ? undefined : widgetValue(node.color, values);
        const style = node.style === undefined ? undefined : widgetValue(node.style, values);
        const loading = node.loading !== undefined && Boolean(widgetValue(node.loading, values));
        const variant = style === "outline" ? "outline" : style === "ghost" ? "ghost" : style === "soft" ? "secondary"
          : color === "danger" ? "destructive" : color === "secondary" ? "secondary" : "default";
        return (
          <Button key={key} className="chat-widget-button" type={"submitForm" in action ? "submit" : "button"} data-chat-submit={sends ? "" : undefined}
            aria-label={node.label ? iconLabels.get(node.label) ?? node.label : undefined} variant={variant}
            size={node.uniform ? "icon" : node.size === "xs" || node.size === "sm" ? "sm" : node.size === "lg" || node.size === "xl" ? "lg" : "default"}
            aria-busy={loading || undefined} data-block={node.block} data-size={node.size} data-style={typeof style === "string" ? style : undefined}
            data-widget-color={typeof color === "string" ? color : undefined}
            disabled={streaming || (sends && !canSend) || (node.disabled !== undefined && Boolean(widgetValue(node.disabled, values)))
              || ("adjust" in action && Number(values.get(action.adjust.name)) === action.adjust.bound)}
            onClick={(event) => {
              if (!("submit" in action) || event.currentTarget.form?.reportValidity() !== false) applyAction(action);
            }}>
            {loading && <LoaderCircle className="chat-widget-button-spinner" aria-hidden="true" />}
            {node.children.map((child, index) => child.kind === "markdown"
              ? <span key={index}>{child.parts.map((part) => typeof part === "string" ? part : widgetValue(part.value, values)).join("")}</span>
              : renderNode(child, `${key}-${index}`))}
          </Button>
        );
      }
    }
  }

  function renderTableRow(node: Extract<WidgetNode, { kind: "table-row" }>, key: string, header = false) {
    const Cell = header ? "th" : "td";
    return <tr key={key}>{node.children.map((cell, index) => <Cell key={index} scope={header ? "col" : undefined}
      style={{ textAlign: cell.align === "end" ? "end" : cell.align === "center" ? "center" : undefined, width: cell.width === undefined ? undefined : `${cell.width}%` }}>
      {cell.children.map((child, position) => renderNode(child, `${key}-${index}-${position}`))}
    </Cell>)}</tr>;
  }

  const contents = renderNode(root, "widget");
  return widget.form && !widget.explicitForm
    ? <form className="chat-widget chat-reply-form" onSubmit={(event) => submitForm(event)}>
      {contents}
      <button type="submit" hidden disabled={streaming || !canSend} />
    </form>
    : <div className="chat-widget">{contents}</div>;
}
