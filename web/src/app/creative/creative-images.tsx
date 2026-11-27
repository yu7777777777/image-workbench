"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { request } from "@/lib/request";

type ExampleSource = { itemId: string; exampleId: string; revision: string };
export type EditableExample = { key: string; file: File } | { key: string; source: ExampleSource };

const MAX_EXAMPLES = 6;

export function CreativeImage({ source, file, className = "", alt }: { source?: ExampleSource; file?: File; className?: string; alt: string }) {
  const [src, setSrc] = useState("");
  const { itemId, exampleId, revision } = source ?? {};
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    const show = (blob: Blob) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    };
    setSrc("");
    if (file) show(file);
    else if (itemId && exampleId) {
      void request.get<Blob>(`/api/creative/${itemId}/examples/${exampleId}`, { responseType: "blob", signal: controller.signal })
        .then(({ data }) => show(data)).catch(() => {});
    }
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, itemId, exampleId, revision]);

  return src
    ? <img src={src} alt={alt} className={className} />
    : <div aria-hidden="true" className={`grid aspect-[3/2] place-items-center bg-muted/55 text-muted-foreground ${className}`}>
      <ImageIcon className="size-5 opacity-55" />
    </div>;
}

export function CreativeExampleGallery({ itemId, exampleIds, revision }: { itemId: string; exampleIds: string[]; revision: string }) {
  const [selectedId, setSelectedId] = useState(exampleIds[0]);
  return (
    <div className="grid min-w-0 gap-2" data-creative-media>
      <div className="flex min-h-36 items-center justify-center rounded-xl bg-muted/45 p-2 sm:p-3">
        <CreativeImage key={selectedId} source={{ itemId, exampleId: selectedId, revision }} alt={`示例图 ${exampleIds.indexOf(selectedId) + 1}`}
          className="max-h-[min(56dvh,44rem)] w-full rounded-lg object-contain md:max-h-[min(68dvh,46rem)]"
        />
      </div>
      {exampleIds.length > 1 && (
        <div className="flex gap-2 overflow-x-auto p-0.5">
          {exampleIds.map((exampleId, index) => (
            <button key={exampleId} type="button" aria-label={`查看示例图 ${index + 1}`} aria-pressed={selectedId === exampleId}
              className={`size-14 shrink-0 overflow-hidden rounded-md border ${selectedId === exampleId ? "ring-2 ring-primary" : ""}`}
              onClick={() => setSelectedId(exampleId)}>
              <CreativeImage source={{ itemId, exampleId, revision }} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CreativeExampleInput({ examples, onChange, disabled }: {
  examples: EditableExample[];
  onChange: (examples: EditableExample[]) => void;
  disabled: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const fileSequence = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  function add(files: FileList | null) {
    if (!files?.length || disabled) return;
    const incoming = Array.from(files);
    const valid = incoming.filter((file) => file.size > 0 && file.size <= 5 * 1024 * 1024 &&
      (["image/png", "image/jpeg", "image/webp"].includes(file.type) || (!file.type && /\.(?:png|jpe?g|webp)$/i.test(file.name))));
    const available = MAX_EXAMPLES - examples.length;
    if (incoming.length !== valid.length) setError("请选择 JPG、PNG 或 WebP 图片，每张最多 5 MB。");
    else if (valid.length > available) setError(`最多保留 ${MAX_EXAMPLES} 张示例图。`);
    else setError("");
    onChange([...examples, ...valid.slice(0, available).map((file) => ({ key: `new-${fileSequence.current++}`, file }))]);
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">示例图（可选）</p>
      <div onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        if (!disabled) setDragging(true);
      }} onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }} onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        add(event.dataTransfer.files);
      }}>
        <button type="button" disabled={disabled || examples.length >= MAX_EXAMPLES}
          className={`flex w-full flex-col items-center gap-1 rounded-xl border border-dashed px-3 py-3 text-sm focus-visible:outline-primary disabled:opacity-55 ${dragging ? "border-primary bg-primary/10" : "bg-muted/40 hover:bg-muted/65"}`}
          onClick={() => fileInput.current?.click()}>
          <span className="flex items-center gap-2"><Upload className="size-4" />拖入图片或点击选择</span>
          <span className="text-xs text-muted-foreground">{examples.length} / {MAX_EXAMPLES} 张 · 每张不超过 5 MB</span>
        </button>
        <input type="file" aria-label="选择示例图" multiple accept="image/png,image/jpeg,image/webp" hidden ref={fileInput}
          onChange={(event) => {
            add(event.target.files);
            event.target.value = "";
          }} />
      </div>
      {examples.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {examples.map((example, index) => (
            <div key={example.key} className="relative w-[4.5rem]">
              <CreativeImage file={"file" in example ? example.file : undefined} source={"source" in example ? example.source : undefined}
                alt={`示例图 ${index + 1}`} className="aspect-square w-full rounded-md border object-cover" />
              <Button type="button" aria-label={`移除示例图 ${index + 1}`} disabled={disabled} size="icon" variant="outline"
                className="absolute top-1 right-1 size-6 rounded-full bg-background/95"
                onClick={() => { setError(""); onChange(examples.filter(({ key }) => key !== example.key)); }}><X className="size-3" /></Button>
              {index === 0 ? <p className="pt-1 text-center text-xs text-muted-foreground">封面</p> :
                <button type="button" disabled={disabled} className="w-full pt-1 text-xs text-primary"
                  onClick={() => onChange([example, ...examples.filter(({ key }) => key !== example.key)])}>设为封面</button>}
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
