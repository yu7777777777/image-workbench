import { useId, useState, type ReactNode } from "react";
import { BookOpen, CheckCircle, Globe, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { escapeReplyMarkdown } from "@/lib/chat-rich-reply";
import { widgetValue, type ChatWidget, type WidgetNode } from "@/lib/chat-widget";
import { ReplyMarkdown } from "./chat-markdown";
import { ReplyChart } from "./chat-chart";

const icons = new Map([
  ["book-open", BookOpen],
  ["check-circle", CheckCircle],
  ["rotate-ccw", RotateCcw],
  ["globe", Globe],
  ["minus", Minus],
  ["plus", Plus],
]);

export function ChatWidgetView({ widget, streaming, canSend, onSend }: {
  widget: ChatWidget;
  streaming: boolean;
  canSend: boolean;
  onSend: (text: string) => void;
}) {
  const id = useId();
  const [values, setValues] = useState(widget.initial);
  const setValue = (name: string, value: string | number | boolean) => setValues((current) => new Map(current).set(name, value));

  function renderNode(node: WidgetNode, key: string): ReactNode {
    switch (node.kind) {
      case "markdown": {
        const text = node.parts.map((part) => typeof part === "string" ? part : escapeReplyMarkdown(String(widgetValue(part.value, values)))).join("");
        return <div className="chat-widget-markdown" key={key}><ReplyMarkdown text={text} /></div>;
      }
      case "layout":
        return <div className={`chat-widget-${node.variant}`} key={key}>{node.children.map((child, index) => renderNode(child, `${key}-${index}`))}</div>;
      case "icon": {
        const Icon = icons.get(node.name);
        return Icon ? <Icon key={key} size={15} aria-hidden="true" /> : null;
      }
      case "divider":
        return <hr key={key} />;
      case "radio":
        return (
          <fieldset key={key} className="chat-widget-options" disabled={streaming}>
            <legend>{node.label}</legend>
            {node.options.map((option) => (
              <label key={option.value}>
                <input type="radio" name={`${id}-${node.name}`} value={option.value} checked={values.get(node.name) === option.value} onChange={() => setValue(node.name, option.value)} />
                {option.label}
              </label>
            ))}
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
      case "chart":
        return <ReplyChart key={key} {...node} rows={node.rows.map(({ name, values: rowValues }) => ({
          name,
          values: rowValues.map((value) => {
            const number = Number(widgetValue(value, values));
            return Number.isFinite(number) ? number : 0;
          }),
        }))} />;
      case "condition":
        return <div className="chat-widget-condition" key={key}>{(Number(widgetValue(node.value, values)) > node.threshold ? node.children : node.fallback).map((child, index) => renderNode(child, `${key}-${index}`))}</div>;
      case "link":
        return node.href ? <a key={key} href={node.href} target="_blank" rel="noopener noreferrer">{node.label}</a> : <span key={key} className="chat-unavailable-link">{node.label}（来源链接未返回）</span>;
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
      case "button": {
        const { action } = node;
        const submit = "submit" in action;
        return (
          <Button key={key} type="button" aria-label={node.label} variant={submit ? "default" : "outline"}
            disabled={streaming || (submit && !canSend) || ("adjust" in action && Number(values.get(action.adjust.name)) === action.adjust.bound)}
            onClick={() => {
              if ("submit" in action) {
                if (canSend && !streaming) onSend(String(widgetValue(action.submit, values)));
              } else if ("adjust" in action) {
                const {name, change, bound} = action.adjust;
                setValues((current) => {
                  const next = Number(current.get(name)) + change;
                  return new Map(current).set(name, change > 0 ? Math.min(bound, next) : Math.max(bound, next));
                });
              } else {
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
  return widget.form
    ? <form className="chat-widget chat-reply-form" onSubmit={(event) => event.preventDefault()}>{contents}</form>
    : <div className="chat-widget">{contents}</div>;
}
