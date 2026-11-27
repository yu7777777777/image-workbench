import { createElement, useId, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  Activity, AlarmClock, AlertCircle, AlertTriangle, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight,
  Award, Bed, Bell, Book, Bookmark, BookOpen, Box, Briefcase, BriefcaseBusiness, Building, Building2, Bus, Calendar,
  CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, CalendarRange, Camera, Car, ChartColumn, ChartLine,
  ChartNoAxesCombined, ChartPie, Check, CheckCircle, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Circle, CircleDot, CirclePlus, ClipboardCheck, ClipboardList, Clock, Cloud, Code, Code2, Coffee, Compass, Copy,
  CornerDownRight, Cpu, CreditCard, Database, Download, Dumbbell, Ellipsis, EllipsisVertical, ExternalLink, Eye, File,
  FileSpreadsheet, FileText, Filter, Flag, Flame, Folder, FormInput, GitBranch, Globe, GraduationCap, Grid2x2, Heart,
  HelpCircle, History, Home, House, Image as ImageIcon, Inbox, Info, Landmark, Layers, LayoutDashboard, LayoutPanelTop,
  Leaf, Lightbulb, Link, List, ListChecks, ListTodo, LoaderCircle, Lock, Mail, Map as MapIcon, MapPin, Menu,
  MessageSquare, Mic, Minus, Moon, MousePointerClick, Package, Palette, PanelLeft, PanelsTopLeft, Paperclip, Pause,
  Pencil, PenTool, Phone, PiggyBank, Pin, Plane, Play, Plus, Power, Receipt, RefreshCw, Repeat, Rocket, RotateCcw,
  Search, Send, Server, Settings, Share2, Shield, ShoppingBag, ShoppingCart, SlidersHorizontal, Sparkles, Star, Sun,
  Table, Tag, Target, Terminal, TextCursorInput, ThumbsDown, ThumbsUp, Ticket, Timer, ToggleRight, Train, TrainFront,
  Trash2, TrendingDown, TrendingUp, Trophy, Type, Unlock, Upload, User, Users, Utensils, Video, Volume2, Wallet,
  Workflow, X, XCircle, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { escapeReplyMarkdown } from "@/lib/chat-rich-reply";
import { applyWidgetArrayAction, widgetValue, type ChatWidget, type WidgetImage, type WidgetNode, type WidgetResourceType, type WidgetStateValue } from "@/lib/chat-widget";
import type { ChatResource } from "@/lib/chat-resources";
import { CodeBlock, copyReplyText, ReplyMarkdown } from "./chat-markdown";
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
  ["activity", Activity], ["bell", Bell], ["calendar", Calendar],
  ["calendar-days", CalendarDays], ["calendar-range", CalendarRange], ["calendar-check", CalendarCheck],
  ["calendar-clock", CalendarClock], ["calendar-plus", CalendarPlus],
  ["camera", Camera], ["chart-line", ChartLine], ["chart-no-axes-combined", ChartNoAxesCombined],
  ["cloud", Cloud], ["code", Code], ["code-2", Code2], ["folder", Folder], ["heart", Heart], ["home", Home], ["house", House], ["image", ImageIcon],
  ["info", Info], ["mail", Mail], ["mouse-pointer-click", MousePointerClick], ["search", Search], ["settings", Settings],
  ["user", User], ["users", Users],
  ["check", Check], ["chevron-down", ChevronDown], ["chevron-left", ChevronLeft], ["chevron-right", ChevronRight], ["chevron-up", ChevronUp],
  ["circle", Circle], ["circle-dot", CircleDot], ["circle-plus", CirclePlus], ["corner-down-right", CornerDownRight], ["file-text", FileText], ["chart-column", ChartColumn],
  ["layout-dashboard", LayoutDashboard], ["layout-panel-top", LayoutPanelTop], ["panels-top-left", PanelsTopLeft],
  ["power", Power], ["shopping-bag", ShoppingBag], ["shopping-cart", ShoppingCart], ["trash-2", Trash2],
  ["download", Download], ["palette", Palette], ["pen-tool", PenTool], ["file-spreadsheet", FileSpreadsheet],
  ["file", File], ["sparkles", Sparkles], ["cpu", Cpu], ["zap", Zap], ["shield", Shield], ["star", Star],
  ["arrow-right", ArrowRight], ["arrow-left", ArrowLeft], ["arrow-up", ArrowUp], ["arrow-down", ArrowDown], ["arrow-up-right", ArrowUpRight],
  ["external-link", ExternalLink],
  ["play", Play], ["pause", Pause], ["volume-2", Volume2], ["map-pin", MapPin], ["map", MapIcon],
  ["sliders-horizontal", SlidersHorizontal], ["check-square", CheckSquare], ["layers", Layers],
  ["bar-chart", ChartColumn], ["bar-chart-2", ChartColumn], ["bar-chart-3", ChartColumn], ["chart", ChartColumn],
  ["pie-chart", ChartPie], ["chart-pie", ChartPie], ["trending-up", TrendingUp], ["trending-down", TrendingDown],
  ["alert-triangle", AlertTriangle], ["alert-circle", AlertCircle], ["circle-alert", AlertCircle],
  ["x", X], ["x-circle", XCircle], ["copy", Copy], ["pencil", Pencil], ["edit", Pencil], ["eye", Eye],
  ["filter", Filter], ["refresh-cw", RefreshCw], ["database", Database], ["server", Server],
  ["terminal", Terminal], ["box", Box], ["grid", Grid2x2], ["list", List], ["table", Table],
  ["clock", Clock], ["tag", Tag], ["bookmark", Bookmark], ["share", Share2], ["share-2", Share2],
  ["send", Send], ["message-square", MessageSquare], ["thumbs-up", ThumbsUp], ["thumbs-down", ThumbsDown],
  ["help-circle", HelpCircle], ["circle-help", HelpCircle],
  ["inbox", Inbox], ["list-todo", ListTodo], ["list-checks", ListChecks],
  ["clipboard-list", ClipboardList], ["clipboard-check", ClipboardCheck],
  ["briefcase", Briefcase], ["briefcase-business", BriefcaseBusiness], ["compass", Compass], ["menu", Menu],
  ["ellipsis", Ellipsis], ["ellipsis-vertical", EllipsisVertical], ["panel-left", PanelLeft],
  ["target", Target], ["flag", Flag], ["pin", Pin], ["archive", Archive],
  ["flame", Flame], ["award", Award], ["trophy", Trophy], ["coffee", Coffee],
  ["sun", Sun], ["moon", Moon], ["timer", Timer], ["alarm-clock", AlarmClock],
  ["repeat", Repeat], ["history", History],
  ["lock", Lock], ["unlock", Unlock], ["link", Link], ["paperclip", Paperclip], ["upload", Upload],
  ["lightbulb", Lightbulb], ["rocket", Rocket], ["graduation-cap", GraduationCap], ["book", Book],
  ["phone", Phone], ["video", Video], ["mic", Mic], ["credit-card", CreditCard], ["wallet", Wallet],
  ["package", Package], ["plane", Plane], ["car", Car], ["bus", Bus], ["train", Train], ["train-front", TrainFront],
  ["utensils", Utensils], ["dumbbell", Dumbbell], ["leaf", Leaf], ["bed", Bed], ["ticket", Ticket],
  ["building", Building], ["building-2", Building2], ["landmark", Landmark], ["piggy-bank", PiggyBank],
  ["receipt", Receipt], ["type", Type], ["form-input", FormInput], ["text-cursor-input", TextCursorInput],
  ["workflow", Workflow], ["toggle-right", ToggleRight], ["git-branch", GitBranch],
]);

const iconAliases = new Map([
  ["warning", "alert-triangle"],
  ["error", "alert-circle"],
  ["close", "x"],
  ["delete", "trash-2"],
  ["house", "home"],
  ["sliders", "sliders-horizontal"],
  ["design", "palette"],
  ["refresh", "refresh-cw"],
  ["more-horizontal", "ellipsis"],
  ["more-vertical", "ellipsis-vertical"],
  ["plus-circle", "circle-plus"],
  ["gear", "settings"],
  ["cog", "settings"],
  ["link-2", "link"],
]);

export function resolveIcon(raw: string) {
  const stripped = raw.trim().replace(/^(?:lucide-react|lucide|icon):/i, "");
  const normalized = stripped.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[_\s]+/g, "-").toLowerCase();
  return icons.get(normalized) ?? icons.get(iconAliases.get(normalized) ?? "");
}

const iconLabels = new Map([
  ["plus", "添加"], ["search", "搜索"], ["settings", "设置"], ["trash-2", "删除"], ["heart", "收藏"],
]);

const iconSizes = new Map([["xs", 13], ["sm", 15], ["md", 16], ["lg", 19], ["xl", 22], ["2xl", 26], ["3xl", 32]]);

function resolveIconSize(size?: string): number {
  if (!size) return 15;
  const trimmed = size.trim().toLowerCase();
  const mapped = iconSizes.get(trimmed);
  if (mapped !== undefined) return mapped;
  const numeric = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(trimmed);
  if (numeric) {
    const px = Math.round(Number(numeric[1]));
    if (Number.isFinite(px)) return Math.min(32, Math.max(12, px));
  }
  return 15;
}

const layoutRadii = { none: 0, sm: 6, md: 7, lg: 10, xl: 14, "2xl": 18, "3xl": 24, full: 999 };
type WidgetLayoutOptions = Extract<WidgetNode, { kind: "layout" }>["options"];

const safeColorPattern = /^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgb|hsl)a?\([^;{}()]{1,48}\))$/;
const surfaceTokens: Record<string, string> = {
  surface: "var(--background)",
  "surface-secondary": "var(--muted)",
  "surface-tertiary": "var(--accent)",
  "surface-elevated": "var(--card)",
  "alpha-05": "color-mix(in srgb, var(--foreground) 4%, transparent)",
  transparent: "transparent",
};
const semanticColors = new Set([
  "primary", "emphasis", "secondary", "tertiary", "muted", "subtle",
  "success", "danger", "error", "warning", "info", "discovery", "neutral",
]);

export function isLightHexColor(color: string): boolean {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim());
  if (!match) return false;
  const hex = match[1];
  const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16) / 255;
  const linear = (channel: number) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) > 0.72;
}

function resolveBackground(options: WidgetLayoutOptions, values?: ReadonlyMap<string, WidgetStateValue>) {
  const raw = options?.background !== undefined && values ? widgetValue(options.background, values) : options?.background;
  const text = typeof raw === "string" ? raw.trim() : "";
  const isToken = Boolean(text && text in surfaceTokens);
  const cssValue = isToken ? surfaceTokens[text] : (text && safeColorPattern.test(text) ? text : undefined);
  const hasBackground = Boolean(cssValue && cssValue !== "transparent");
  const hasSurface = options?.surface === true || (options?.surface !== false && isToken && text !== "transparent");
  const isLightSurface = Boolean(cssValue && isLightHexColor(cssValue));
  return { cssValue, hasBackground, hasSurface, isLightSurface };
}

function safeLayoutWidth(value: WidgetStateValue | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const percent = /^(\d+(?:\.\d+)?)%$/.exec(trimmed);
  if (percent) {
    const amount = Number(percent[1]);
    return Number.isFinite(amount) && amount >= 0 && amount <= 100 ? `${amount}%` : undefined;
  }
  const pixels = /^([1-9]\d{0,2})px$/.exec(trimmed);
  if (pixels && Number(pixels[1]) <= 960) return trimmed;
  return undefined;
}

function layoutStyle(
  options: WidgetLayoutOptions,
  verticalGrid = false,
  values?: ReadonlyMap<string, WidgetStateValue>,
  isTextBlock = false,
  cssColor?: string,
): CSSProperties & { "--chat-widget-columns"?: number } {
  const padding = options?.padding;
  const heightPx = options?.height ? /^([1-9]\d?)px$/.exec(options.height) : null;
  const compactBar = Boolean(heightPx && Number(heightPx[1]) <= 20);
  const inset = typeof padding === "object" || options?.square !== undefined || compactBar ? 0 : undefined;
  const justify = options?.justify === "between" ? "space-between" : options?.justify;
  const { cssValue: customBg } = resolveBackground(options, values);
  const width = options?.width !== undefined && values ? safeLayoutWidth(widgetValue(options.width, values)) : undefined;
  const textAlign: CSSProperties["textAlign"] = isTextBlock
    ? (options?.align === "start" ? "left" : options?.align === "center" ? "center" : options?.align === "end" ? "right" : undefined)
    : undefined;
  return {
    gap: options?.gap,
    "--chat-widget-columns": options?.columns,
    flex: options?.flex === undefined ? undefined : `${options.flex} 1 0px`,
    alignItems: verticalGrid || isTextBlock ? undefined : options?.align,
    justifyItems: verticalGrid && !isTextBlock ? options?.align : undefined,
    alignContent: verticalGrid ? justify : undefined,
    justifyContent: verticalGrid ? undefined : justify,
    textAlign,
    color: cssColor,
    paddingTop: (typeof padding === "object" ? padding.top : padding) ?? inset,
    paddingRight: (typeof padding === "object" ? padding.right : padding) ?? inset,
    paddingBottom: (typeof padding === "object" ? padding.bottom : padding) ?? inset,
    paddingLeft: (typeof padding === "object" ? padding.left : padding) ?? inset,
    borderRadius: options?.radius === undefined ? undefined : layoutRadii[options.radius],
    inlineSize: options?.square,
    blockSize: options?.square,
    width,
    minWidth: width ? 0 : undefined,
    background: customBg,
    minHeight: options?.height === "100%" || compactBar ? undefined : options?.height,
    height: options?.height === "100%" ? "100%" : compactBar ? options?.height : undefined,
    overflow: compactBar ? "hidden" : undefined,
    aspectRatio: options?.aspectRatio,
    flexWrap: options?.wrap,
    fontVariantNumeric: options?.numeric ? "tabular-nums" : undefined,
  };
}

export function ChatWidgetView({ widget, streaming, canSend, onSend, onOpenUrl, renderResource, resolveImages }: {
  widget: ChatWidget;
  streaming: boolean;
  canSend: boolean;
  onSend: (text: string) => void;
  onOpenUrl?: (url: string) => void;
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
    else if ("openUrl" in action) {
      const target = String(widgetValue(action.openUrl, values)).trim();
      if (target) onOpenUrl?.(target);
    } else if ("copy" in action) {
      const text = String(widgetValue(action.copy, values));
      if (text) {
        void copyReplyText(text).then((ok) => {
          if (ok) toast.success("已复制到剪贴板");
        });
      }
    } else if ("set" in action) setValues((current) => applyUpdates(current, [action.set]));
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
    if (typeof result !== "string") return undefined;
    const trimmed = result.trim();
    return trimmed ? trimmed.slice(0, 48) : undefined;
  }

  function resolveColor(value: Parameters<typeof widgetValue>[0] | undefined): { dataColor?: string; cssColor?: string } {
    const raw = resolveText(value);
    if (!raw) return {};
    const lower = raw.toLowerCase();
    if (semanticColors.has(lower)) return { dataColor: lower };
    if (safeColorPattern.test(raw)) return { cssColor: raw };
    return {};
  }

  function renderInlineChildren(children: WidgetNode[], key: string): ReactNode {
    return children.map((child, index) => {
      if (child.kind === "markdown") {
        return child.parts.map((part) => typeof part === "string" ? part : String(widgetValue(part.value, values))).join("");
      }
      return renderNode(child, `${key}-${index}`);
    });
  }

  function renderNode(node: WidgetNode, key: string): ReactNode {
    switch (node.kind) {
      case "markdown": {
        const text = node.parts.map((part) => typeof part === "string" ? part : escapeReplyMarkdown(String(widgetValue(part.value, values)))).join("");
        return <div className="chat-widget-markdown" key={key}><ReplyMarkdown text={text} /></div>;
      }
      case "inline": {
        const { dataColor, cssColor } = resolveColor(node.color);
        const className = node.tag === "u" ? "chat-widget-underline" : node.tag === "s" ? "chat-widget-strikethrough" : undefined;
        return createElement(
          node.tag,
          { key, className, "data-color": dataColor, style: cssColor ? { color: cssColor } : undefined },
          renderInlineChildren(node.children, key),
        );
      }
      case "layout": {
        const options = node.options;
        const isTextBlock = node.variant === "title" || node.variant === "text" || node.variant === "caption";
        const isSurfaceContainer = node.variant === "box" || node.variant === "card";
        const verticalGrid = (node.variant === "box" && options?.direction !== "row") || node.variant === "col" || node.variant === "card" || node.variant === "callout";
        const { hasBackground, hasSurface, isLightSurface } = resolveBackground(options, values);
        const { dataColor, cssColor } = resolveColor(options?.color);
        const style = layoutStyle(options, verticalGrid, values, isTextBlock, cssColor);
        const hasFlex = node.variant === "row" && node.children.length > 0 && node.children.every(
          (child) => (child.kind === "layout" || child.kind === "pressable") && child.options?.flex !== undefined,
        );
        const inlineFlow = (isTextBlock || node.variant === "badge" || node.variant === "label")
          && node.children.some((child) => child.kind === "inline")
          && node.children.every((child) => child.kind === "markdown" || child.kind === "inline" || child.kind === "icon" || child.kind === "link");
        const Container = node.variant === "blockquote" ? "blockquote" : "div";
        return <Container
          className={`chat-widget-${node.variant}`}
          data-border={options?.border === true ? "true" : options?.border === false ? "false" : undefined}
          data-surface={hasSurface ? "true" : undefined}
          data-background={hasBackground ? "true" : undefined}
          data-theme={isSurfaceContainer ? options?.theme : undefined}
          data-surface-tone={isSurfaceContainer && isLightSurface ? "light" : undefined}
          data-color={dataColor}
          data-size={options?.size}
          data-weight={options?.weight}
          data-variant={options?.variant}
          data-direction={node.variant === "box" && options?.direction === "row" ? "row" : undefined}
          data-wrap={node.variant === "row" ? options?.wrap : undefined}
          data-has-flex={hasFlex ? "true" : undefined}
          data-flex={options?.flex !== undefined ? "true" : undefined}
          data-square={options?.square !== undefined ? "true" : undefined}
          style={style}
          key={key}
        >
          {inlineFlow ? renderInlineChildren(node.children, key) : node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
        </Container>;
      }
      case "form":
        return <form className="chat-widget-form" aria-label={node.label} onSubmit={(event) => submitForm(event, node.submit, node.action)} key={key}>
          {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
        </form>;
      case "popover": {
        const Icon = node.icon ? resolveIcon(node.icon) : ChevronDown;
        const trailing = !node.icon || node.icon === "chevron-down";
        const glyph = Icon && <Icon size={15} aria-hidden="true" className={trailing ? "chat-widget-popover-chevron" : undefined} />;
        return <Popover key={key}>
          <PopoverTrigger asChild><Button variant="outline" size="sm" className="chat-widget-popover-trigger" data-block={node.block ? "true" : undefined} disabled={streaming}>
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
        const { hasBackground, hasSurface, isLightSurface } = resolveBackground(options, values);
        const style = layoutStyle(options, true, values);
        const disabled = streaming || ("submit" in action && !canSend);
        const ariaPressed = expanded === undefined && typeof value === "boolean" ? value : undefined;
        if (node.variant === "link" && !hasBackground && !hasSurface) {
          return (
            <button
              key={key}
              type="button"
              className="chat-widget-pressable"
              data-variant="link"
              data-flex={options.flex !== undefined ? "true" : undefined}
              disabled={disabled}
              aria-label={node.label}
              aria-expanded={expanded}
              aria-pressed={ariaPressed}
              style={style}
              onClick={() => applyAction(action)}
            >
              {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
            </button>
          );
        }
        return <div
          key={key}
          className="chat-widget-pressable"
          data-border={options.border === true ? "true" : options.border === false ? "false" : undefined}
          data-surface={hasSurface ? "true" : undefined}
          data-background={hasBackground ? "true" : undefined}
          data-theme={options.theme}
          data-surface-tone={isLightSurface ? "light" : undefined}
          data-flex={options.flex !== undefined ? "true" : undefined}
          style={style}
        >
          {node.children.map((child, index) => renderNode(child, `${key}-${index}`))}
          <button type="button" disabled={disabled} aria-label={node.label}
            aria-expanded={expanded} aria-pressed={ariaPressed}
            onClick={() => applyAction(action)} />
        </div>;
      }
      case "map": {
        const hasDetails = node.markers.some((item) => item.description || item.group);
        if (!hasDetails) return <WidgetMap label={node.label} markers={node.markers} key={key} />;
        return <div className="chat-widget-col" key={key}>
          <WidgetMap label={node.label} markers={node.markers} />
          <ul className="chat-widget-list">
            {node.markers.map((item, index) => (
              <li className="chat-widget-list-item" key={index}>
                <strong>{item.label}</strong>
                {item.description && <span> · {item.description}</span>}
              </li>
            ))}
          </ul>
        </div>;
      }
      case "video":
        return <WidgetVideo label={node.label} src={node.src} key={key} />;
      case "icon": {
        const Icon = resolveIcon(String(widgetValue(node.name, values)));
        const { dataColor, cssColor } = resolveColor(node.color);
        return Icon ? <Icon key={key} size={resolveIconSize(node.size)} aria-hidden="true" data-color={dataColor} style={cssColor ? { color: cssColor } : undefined} /> : null;
      }
      case "divider": {
        const spacingToken = typeof node.spacing === "string" ? node.spacing : node.spacing === 0 ? "none" : undefined;
        const { dataColor, cssColor } = resolveColor(node.color);
        const spacingStyle: CSSProperties | undefined = typeof node.spacing === "number" || cssColor
          ? {
            ...(typeof node.spacing === "number"
              ? (node.orientation === "vertical" ? { marginInline: node.spacing } : { marginBlock: node.spacing })
              : {}),
            ...(cssColor ? { borderColor: cssColor } : {}),
          }
          : undefined;
        return (
          <hr
            key={key}
            className="chat-widget-divider"
            data-spacing={spacingToken}
            data-flush={node.flush === true ? "true" : node.flush === false ? "false" : undefined}
            data-orientation={node.orientation}
            data-color={dataColor}
            style={spacingStyle}
          />
        );
      }
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
          <fieldset key={key} className={node.segmented ? "chat-widget-options chat-widget-segmented" : "chat-widget-options"} data-horizontal={node.horizontal} data-block={node.block ? "true" : undefined} disabled={streaming}>
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
            aria-label={node.label?.trim() || "调整滑块"}
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
        return <ReplyChart key={key} chartType={node.chartType} label={node.label} series={node.series} description={node.description} min={node.min} rows={rows.map(({ name, x, values: rowValues }) => {
          const parsedX = x === undefined ? undefined : Number(widgetValue(x, values));
          return {
            name: String(widgetValue(name, values)),
            x: parsedX !== undefined && Number.isFinite(parsedX) ? parsedX : undefined,
            values: rowValues.map((value) => {
              const number = Number(widgetValue(value, values));
              return Number.isFinite(number) ? number : 0;
            }),
          };
        })} />;
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
        const isSwitch = Boolean(node.switch || node.shape === "switch");
        return <label className="chat-widget-checkbox" data-switch={isSwitch || undefined} data-shape={node.shape === "switch" ? "switch" : undefined} data-compact={node.compact || undefined} data-line-through={node.lineThrough ? "true" : undefined} key={key}>
          <input type="checkbox" role={isSwitch ? "switch" : undefined} data-shape={node.shape === "switch" ? "switch" : undefined} aria-label={node.compact ? node.label : undefined}
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
