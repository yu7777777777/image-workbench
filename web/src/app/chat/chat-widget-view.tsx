import { useId, useState, type ReactNode } from "react";
import { BookOpen, CheckCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { escapeReplyMarkdown } from "@/lib/chat-rich-reply";
import { widgetValue, type ChatWidget, type WidgetNode } from "@/lib/chat-widget";
import { ReplyMarkdown } from "./chat-markdown";

const icons = new Map([
  ["book-open", BookOpen],
  ["check-circle", CheckCircle],
  ["rotate-ccw", RotateCcw],
]);

function WidgetChart({ node, values }: {
  node: Extract<WidgetNode, { kind: "chart" }>;
  values: ChatWidget["initial"];
}) {
  const bars = node.bars.map(({ name, value }) => {
    const number = Number(widgetValue(value, values));
    return { name, number: Number.isFinite(number) ? number : 0 };
  });
  const low = Math.min(0, node.min, ...bars.map(({ number }) => number));
  const high = Math.max(low + 1, ...bars.map(({ number }) => number));
  const range = high - low;
  const base = -low / range * 100;

  return (
    <figure className="chat-widget-chart" aria-label={node.label}>
      <div className="chat-chart-bars">
        {bars.map(({ name, number }, index) => (
          <div className="chat-chart-column" key={index}>
            <div className="chat-chart-track" aria-hidden="true">
              <span style={{ bottom: `${base}%` }} />
              <i style={{ bottom: `${(Math.min(0, number) - low) / range * 100}%`, height: `${Math.abs(number) / range * 100}%` }} />
            </div>
            <div><strong>{number}</strong> <span>{name}</span></div>
          </div>
        ))}
      </div>
      {node.description && <figcaption>{node.description}</figcaption>}
    </figure>
  );
}

export function ChatWidgetView({ widget, streaming, canSend, onSend }: {
  widget: ChatWidget;
  streaming: boolean;
  canSend: boolean;
  onSend: (text: string) => void;
}) {
  const id = useId();
  const [values, setValues] = useState(widget.initial);
  const setValue = (name: string, value: string | number) => setValues((current) => new Map(current).set(name, value));

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
        return <WidgetChart key={key} node={node} values={values} />;
      case "button": {
        const { action } = node;
        const submit = "submit" in action;
        return (
          <Button key={key} type="button" variant={submit ? "default" : "outline"} disabled={streaming || (submit && !canSend)}
            onClick={() => {
              if ("submit" in action) {
                if (canSend && !streaming) onSend(String(widgetValue(action.submit, values)));
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
