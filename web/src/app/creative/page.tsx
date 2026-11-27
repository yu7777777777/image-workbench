"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Library, Plus, Search, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { httpRequest } from "@/lib/request";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { CreativeExampleGallery, CreativeExampleInput, CreativeImage, type EditableExample } from "./creative-images";
import "./creative.css";

const categories = { prompt: "生图提示词", skill: "Agent 生图技能" } as const;
const filters = { all: "全部", ...categories } as const;
const useDescriptions = {
  prompt: "填入画廊、Agent 或画布，生成前可以继续编辑。",
  skill: "应用到当前 Agent 对话，指导它梳理需求、优化提示词或分步生图。",
};
type Kind = keyof typeof useDescriptions;
type Item = { id: string; kind: Kind; title: string; display_title: string; content: string; updated_at: string; example_ids: string[]; is_favorite: boolean };
type Filters = { kind: keyof typeof filters; query: string; favoritesOnly: boolean };
const targets = {
  gallery: "填入画廊",
  agent: "填入 Agent",
  canvas: "添加到画布",
};

function previewContent(item: Item) {
  if (item.kind !== "skill") return item.content;
  return item.content
    .replace(/^---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/, "")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

function readFilters(storageKey: string): Filters {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null");
    if (saved && typeof saved.query === "string") {
      const kind = saved.kind === "style" ? "prompt" : saved.kind;
      return {
        kind: kind === "prompt" || kind === "skill" ? kind : "all",
        query: saved.query,
        favoritesOnly: saved.favoritesOnly === true,
      };
    }
  } catch {}
  return { kind: "all", query: "", favoritesOnly: false };
}

export default function CreativePage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);
  if (isCheckingAuth) return <div className="admin-page text-sm text-muted-foreground" role="status">正在加载创意广场…</div>;
  return session?.role === "admin" ? <CreativeLibrary key={session.subjectId} storageKey={`creative-filters:${session.subjectId}`} /> : null;
}

function CreativeMasonry({ items, pending, onOpen, onFavorite }: {
  items: Item[];
  pending: string[];
  onOpen: (item: Item) => void;
  onFavorite: (item: Item) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const cards = Array.from(grid.current?.querySelectorAll("article") ?? []);
    const setHeight = (card: Element, height: number) => {
      const slot = card.parentElement;
      if (slot) slot.style.gridRowEnd = `span ${Math.ceil((height + 16) / 4)}`;
    };
    const heights = cards.map((card) => card.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeight(entry.target, entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height);
      }
    });
    cards.forEach((card, index) => {
      setHeight(card, heights[index]);
      observer.observe(card);
    });
    return () => observer.disconnect();
  }, [items]);

  return <div ref={grid} className="creative-masonry">
    {items.map((item) => (
      <div key={item.id}>
        <article className="relative overflow-hidden rounded-xl border bg-card shadow-xs hover:border-muted-foreground/40">
          <button type="button" aria-label={item.display_title} onClick={() => onOpen(item)} className="block w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
            {item.example_ids.length ? <>
              <CreativeImage source={{ itemId: item.id, exampleId: item.example_ids[0], revision: item.updated_at }}
                alt="" className="block h-auto w-full" />
              {item.example_ids.length > 1 && <span className="absolute right-2 bottom-2 rounded-full bg-black/65 px-2 py-0.5 text-xs text-white">{item.example_ids.length} 张</span>}
            </> : (
              <div className="grid gap-2 p-4">
                <span className="pr-10 text-xs text-muted-foreground">{categories[item.kind]}</span>
                {item.title && <h2 className="break-words pr-9 text-base font-semibold">{item.title}</h2>}
                <p className="line-clamp-3 text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">{previewContent(item)}</p>
              </div>
            )}
          </button>
          <Button type="button" variant="outline" size="icon"
            className="absolute top-2 right-2 size-9 rounded-full bg-background/95 shadow-xs"
            aria-label={`${item.is_favorite ? "取消收藏" : "收藏"} ${item.display_title}`}
            title={item.is_favorite ? "取消收藏" : "收藏"}
            aria-pressed={item.is_favorite}
            disabled={pending.includes(item.id)}
            onClick={() => onFavorite(item)}>
            <Star aria-hidden="true" className={item.is_favorite ? "fill-amber-400 text-amber-600 dark:text-amber-400" : ""} />
          </Button>
        </article>
      </div>
    ))}
  </div>;
}

function CreativeLibrary({ storageKey }: { storageKey: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [viewFilters, setFilters] = useState(() => readFilters(storageKey));
  const { kind: filter, query, favoritesOnly } = viewFilters;
  const [selected, setSelected] = useState<Item | null>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [removing, setRemoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [notice, setNotice] = useState("");
  const [favoriteError, setFavoriteError] = useState("");
  const [pendingFavorites, setPendingFavorites] = useState<string[]>([]);
  const favoriteRequests = useRef(new Set<string>());

  async function refresh() {
    setStatus("loading");
    try {
      const data = await httpRequest<{ items: Item[] }>("/api/creative");
      setItems(data.items);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    try { window.sessionStorage.setItem(storageKey, JSON.stringify(viewFilters)); } catch {}
  }, [storageKey, viewFilters]);

  const needle = query.trim().toLocaleLowerCase();
  const visible = items.filter((item) => (filter === "all" || item.kind === filter) &&
    (!favoritesOnly || item.is_favorite) &&
    (item.title.toLocaleLowerCase().includes(needle) || item.content.toLocaleLowerCase().includes(needle)));

  async function toggleFavorite(item: Item) {
    if (favoriteRequests.current.has(item.id)) return;
    favoriteRequests.current.add(item.id);
    setPendingFavorites([...favoriteRequests.current]);
    setFavoriteError("");
    const favorite = !item.is_favorite;
    try {
      await httpRequest(`/api/creative/${item.id}/favorite`, { method: "PUT", body: { favorite } });
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_favorite: favorite } : entry));
      setSelected((current) => current?.id === item.id ? { ...current, is_favorite: favorite } : current);
      setNotice(favorite ? "已收藏" : "已取消收藏");
    } catch {
      setFavoriteError("收藏更新失败，请重试。");
    } finally {
      favoriteRequests.current.delete(item.id);
      setPendingFavorites([...favoriteRequests.current]);
    }
  }

  async function remove(item: Item) {
    setRemoving(true);
    setDeleteError("");
    try {
      await httpRequest(`/api/creative/${item.id}`, { method: "DELETE" });
      setItems((current) => current.filter(({ id }) => id !== item.id));
      setSelected(null);
      setConfirmDelete(false);
      setNotice("已删除条目");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除失败");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="admin-page space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">创意广场</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="text-sm text-muted-foreground empty:hidden">{notice}</p>
          <Button disabled={status === "loading"} onClick={() => { setNotice(""); setEditing("new"); }}><Plus />新建条目</Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div className="flex flex-wrap gap-1" aria-label="筛选条目类型">
          {(Object.keys(filters) as Filters["kind"][]).map((kind) => (
            <Button key={kind} size="sm" variant={filter === kind ? "secondary" : "ghost"} className={filter === kind ? "bg-primary/10 font-semibold text-primary" : undefined} aria-pressed={filter === kind} onClick={() => setFilters({ ...viewFilters, kind })}>
              {filters[kind]}
            </Button>
          ))}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button type="button" variant={favoritesOnly ? "secondary" : "outline"}
            aria-pressed={favoritesOnly} onClick={() => setFilters({ ...viewFilters, favoritesOnly: !favoritesOnly })}>
            <Star aria-hidden="true" className={favoritesOnly ? "fill-amber-400 text-amber-600 dark:text-amber-400" : ""} />
            只看收藏
          </Button>
          <label className="relative min-w-0 flex-1 sm:w-64">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" type="search" placeholder="搜索名称或正文" aria-label="搜索创意条目" value={query} onChange={(event) => setFilters({ ...viewFilters, query: event.target.value })} />
          </label>
        </div>
      </div>

      {favoriteError && !selected && <p role="alert" className="text-sm text-destructive">{favoriteError}</p>}
      {status === "loading" && <p role="status" className="text-sm text-muted-foreground">正在读取条目…</p>}
      {status === "error" && <div className="flex items-center gap-3 text-sm"><p role="alert">读取条目失败</p><Button size="sm" variant="outline" onClick={() => void refresh()}>重试</Button></div>}
      {status === "ready" && (visible.length ? (
        <CreativeMasonry items={visible} pending={pendingFavorites} onOpen={setSelected} onFavorite={(item) => void toggleFavorite(item)} />
      ) : (
        <div className="grid min-h-56 place-content-center justify-items-center gap-3 rounded-xl border bg-card p-6 text-center">
          <Library aria-hidden="true" className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">{favoritesOnly && !items.some((item) => item.is_favorite) ? "还没有收藏" : items.length ? "没有符合条件的条目" : "还没有创意条目"}</p>
          {favoritesOnly && <Button size="sm" variant="outline" onClick={() => setFilters({ ...viewFilters, favoritesOnly: false })}>浏览全部条目</Button>}
          {!items.length && !favoritesOnly && <Button size="sm" variant="outline" onClick={() => setEditing("new")}><Plus />新建第一个条目</Button>}
        </div>
      ))}

      {selected && <Dialog open onOpenChange={(open) => { if (!open && !removing) { setSelected(null); setConfirmDelete(false); setDeleteError(""); } }}>
        <DialogContent onOpenAutoFocus={(event) => {
          event.preventDefault();
          detailTitleRef.current?.focus({ preventScroll: true });
        }} className={`max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 ${selected.example_ids.length ? "w-[min(94vw,72rem)]" : "w-[min(94vw,38rem)]"}`}>
          <DialogHeader className="border-b px-4 py-4 pr-12 sm:px-6 sm:pr-14">
            <DialogTitle ref={detailTitleRef} tabIndex={-1} className="break-words leading-snug outline-none">{selected.title || categories[selected.kind]}</DialogTitle>
            <DialogDescription className="sr-only">{useDescriptions[selected.kind]}</DialogDescription>
          </DialogHeader>
          <div className={`grid min-h-0 items-start gap-5 overflow-y-auto p-4 sm:p-6 ${selected.example_ids.length ? "md:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]" : ""}`}>
            {selected.example_ids.length > 0 && (
              <CreativeExampleGallery itemId={selected.id} exampleIds={selected.example_ids} revision={selected.updated_at} />
            )}
            <div className="grid min-w-0 gap-3" data-creative-details>
              <h2 className="text-sm font-semibold">{selected.kind === "skill" ? "技能步骤" : "提示词"}</h2>
              <pre className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 font-sans text-sm leading-relaxed [overflow-wrap:anywhere] md:max-h-[52dvh] md:overflow-y-auto">{selected.content}</pre>
              {confirmDelete && <p role="status" className="text-sm text-destructive">删除后，此条目将从创意广场移除。</p>}
              {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
              {favoriteError && <p role="alert" className="text-sm text-destructive">{favoriteError}</p>}
              <DialogFooter className="items-start gap-2 sm:flex-col sm:justify-start">
                {confirmDelete ? <div className="flex flex-wrap gap-2">
                  <Button variant="destructive" size="sm" disabled={removing} onClick={() => void remove(selected)}>{removing ? "正在删除…" : "确认删除"}</Button>
                  <Button variant="ghost" size="sm" disabled={removing} onClick={() => { setConfirmDelete(false); setDeleteError(""); }}>取消删除</Button>
                </div> : <>
                  <div className="flex flex-wrap gap-2">
                    {(selected.kind === "prompt" ? ["gallery", "agent", "canvas"] as const : ["agent"] as const).map((mode) => (
                      <Button key={mode} size="sm" variant={selected.kind === "prompt" ? "outline" : "default"} asChild>
                        <Link href={`/image/?mode=${mode}&creative=${selected.id}`}>
                          {selected.kind === "skill" ? "应用到 Agent 对话" : targets[mode]}
                        </Link>
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" aria-pressed={selected.is_favorite}
                      disabled={pendingFavorites.includes(selected.id)} onClick={() => void toggleFavorite(selected)}>
                      <Star aria-hidden="true" className={selected.is_favorite ? "fill-amber-400 text-amber-600 dark:text-amber-400" : ""} />
                      {selected.is_favorite ? "取消收藏" : "收藏"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(selected); setSelected(null); }}>编辑</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>删除</Button>
                  </div>
                </>}
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>}

      {editing && <CreativeEditor item={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSave={(item) => {
        setItems((current) => [item, ...current.filter(({ id }) => id !== item.id)]);
        setFilters({ kind: "all", query: "", favoritesOnly: false });
        setEditing(null);
        setNotice("已保存条目");
      }} />}
    </section>
  );
}

function CreativeEditor({ item, onClose, onSave }: { item?: Item; onClose: () => void; onSave: (item: Item) => void }) {
  const [kind, setKind] = useState<Kind>(item?.kind ?? "prompt");
  const [title, setTitle] = useState(item?.title ?? "");
  const [content, setContent] = useState(item?.content ?? "");
  const [examples, setExamples] = useState<EditableExample[]>(() => item?.example_ids.map((exampleId) => ({
    key: exampleId, source: { itemId: item.id, exampleId, revision: item.updated_at },
  })) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    setBusy(true);
    try {
      const images = await Promise.all(examples.map(async (example) => {
        if ("source" in example) return { id: example.source.exampleId };
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
          reader.onerror = () => reject(new Error("读取示例图失败"));
          reader.readAsDataURL(example.file);
        });
        return { data };
      }));
      const saved = await httpRequest<Item>(item ? `/api/creative/${item.id}` : "/api/creative", {
        method: item ? "PUT" : "POST",
        body: { kind, title, content, examples: images },
      });
      onSave(saved);
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{item ? "编辑条目" : "新建创意条目"}</DialogTitle><DialogDescription>{useDescriptions[kind]}</DialogDescription></DialogHeader>
      <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="grid gap-1.5 text-sm font-medium">类型
          <select className="h-9 rounded-md border bg-background px-3" value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
            {(Object.keys(categories) as Kind[]).map((key) => <option key={key} value={key}>{categories[key]}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">名称（可选）<Input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="grid gap-1.5 text-sm font-medium">{kind === "prompt" ? "提示词" : "技能步骤"}
          <Textarea className="min-h-36" value={content} required maxLength={16_000} onChange={(event) => setContent(event.target.value)} />
        </label>
        {kind === "skill" && <label className="grid gap-1.5 text-sm font-medium">导入 Markdown（可选）
          <Input type="file" accept=".md,text/markdown" onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setError("");
            try {
              if (!/\.md$/i.test(file.name) || file.size > 64 * 1024) throw new Error("请选择不超过 64 KB 的 Markdown 文件");
              const markdown = await file.text();
              if (!markdown.trim() || markdown.length > 16_000) throw new Error("Markdown 正文需包含 1–16000 字符");
              setContent(markdown);
              setTitle((current) => current || file.name.replace(/\.md$/i, "").slice(0, 60));
            } catch (error) { setError(error instanceof Error ? error.message : "读取 Markdown 失败"); }
          }} />
        </label>}
        <CreativeExampleInput examples={examples} disabled={busy} onChange={setExamples} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="submit" disabled={busy || !content.trim()}>{busy ? "保存中…" : "保存条目"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
