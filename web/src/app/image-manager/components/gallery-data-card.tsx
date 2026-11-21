"use client";

import { useRef, useState } from "react";
import { Archive, Download, HardDrive, LoaderCircle, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function sendIframeMessage(message: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const iframe = document.querySelector('iframe[src*="playground"]') as HTMLIFrameElement | null;
    if (!iframe || !iframe.contentWindow) {
      reject(new Error("画廊工作台尚未就绪，请先访问一次画廊或等待加载完成"));
      return;
    }
    const expectedType = `${message.type.replace("-request", "")}-response`;
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === expectedType) {
        window.removeEventListener("message", handler);
        if (e.data.success) {
          resolve(e.data);
        } else {
          reject(new Error(e.data.error || "操作失败"));
        }
      }
    };
    window.addEventListener("message", handler);
    iframe.contentWindow.postMessage(message, window.location.origin);
    setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("操作响应超时，请重试"));
    }, 60000);
  });
}

export function GalleryDataCard() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 导出配置
  const [exportConfig, setExportConfig] = useState(true);
  const [exportTasks, setExportTasks] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // 导入配置
  const [importConfig, setImportConfig] = useState(true);
  const [importTasks, setImportTasks] = useState(true);
  const [isImporting, setIsImporting] = useState(false);

  // 清除配置
  const [clearConfig, setClearConfig] = useState(false);
  const [clearTasks, setClearTasks] = useState(true);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleExport = async () => {
    if (!exportConfig && !exportTasks) {
      toast.error("请至少勾选一项导出内容");
      return;
    }
    setIsExporting(true);
    try {
      await sendIframeMessage({
        type: "export-data-request",
        options: { exportConfig, exportTasks },
      });
      toast.success("画廊数据导出成功，正在下载备份文件");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setIsImporting(true);
    try {
      await sendIframeMessage({
        type: "import-data-request",
        files,
        options: { importConfig, importTasks },
      });
      toast.success("数据导入成功，画廊已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleClear = async () => {
    if (!clearConfig && !clearTasks) {
      toast.error("请至少勾选一项清理内容");
      return;
    }
    setIsClearing(true);
    try {
      await sendIframeMessage({
        type: "clear-data-request",
        options: { clearConfig, clearTasks },
      });
      toast.success("画廊数据已清空");
      setIsClearDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清空失败");
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <HardDrive className="size-5 text-zinc-700" />
          <CardTitle className="text-base font-semibold">本地画廊数据管理</CardTitle>
        </div>
        <CardDescription className="text-xs text-zinc-500">
          管理当前浏览器保存在本地的画廊历史记录、任务图片以及个人偏好配置，支持全量备份与迁移。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          {/* 导出 */}
          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-zinc-50/50 p-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-medium text-zinc-800 text-sm">
                <Download className="size-4 text-blue-600" />
                导出画廊数据
              </div>
              <p className="text-xs text-zinc-500 leading-5">
                将当前浏览器的画廊任务、生成的图片以及偏好配置打包下载为 ZIP 备份文件。
              </p>
              <div className="flex flex-wrap gap-4 pt-1 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={exportConfig} onCheckedChange={(v) => setExportConfig(Boolean(v))} />
                  <span>包含配置</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={exportTasks} onCheckedChange={(v) => setExportTasks(Boolean(v))} />
                  <span>包含任务和图片</span>
                </label>
              </div>
            </div>
            <Button
              className="mt-4 h-9 w-full rounded-xl bg-zinc-900 text-xs text-white hover:bg-zinc-800"
              onClick={handleExport}
              disabled={isExporting || (!exportConfig && !exportTasks)}
            >
              {isExporting ? <LoaderCircle className="mr-1.5 size-3.5 animate-spin" /> : <Archive className="mr-1.5 size-3.5" />}
              导出 ZIP 备份
            </Button>
          </div>

          {/* 导入 */}
          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-zinc-50/50 p-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-medium text-zinc-800 text-sm">
                <Upload className="size-4 text-emerald-600" />
                导入备份恢复
              </div>
              <p className="text-xs text-zinc-500 leading-5">
                从先前导出的 ZIP 备份文件中恢复历史生图任务与偏好设置。
              </p>
              <div className="flex flex-wrap gap-4 pt-1 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={importConfig} onCheckedChange={(v) => setImportConfig(Boolean(v))} />
                  <span>恢复配置</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={importTasks} onCheckedChange={(v) => setImportTasks(Boolean(v))} />
                  <span>恢复任务与图片</span>
                </label>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              variant="outline"
              className="mt-4 h-9 w-full rounded-xl border-zinc-300 bg-white text-xs text-zinc-800 hover:bg-zinc-100"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
            >
              {isImporting ? <LoaderCircle className="mr-1.5 size-3.5 animate-spin" /> : <Upload className="mr-1.5 size-3.5" />}
              选择 ZIP 文件导入
            </Button>
          </div>

          {/* 清理 */}
          <div className="flex flex-col justify-between rounded-xl border border-rose-100 bg-rose-50/30 p-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-medium text-rose-700 text-sm">
                <Trash2 className="size-4 text-rose-600" />
                清除本地画廊数据
              </div>
              <p className="text-xs text-rose-600/80 leading-5">
                清空当前浏览器中缓存的画廊生图记录或配置。操作不可逆，请先做好备份。
              </p>
              <div className="flex flex-wrap gap-4 pt-1 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-rose-800">
                  <Checkbox checked={clearConfig} onCheckedChange={(v) => setClearConfig(Boolean(v))} />
                  <span>包含配置</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-rose-800">
                  <Checkbox checked={clearTasks} onCheckedChange={(v) => setClearTasks(Boolean(v))} />
                  <span>包含任务与图片</span>
                </label>
              </div>
            </div>
            <Button
              variant="outline"
              className="mt-4 h-9 w-full rounded-xl border-rose-200 bg-white text-xs text-rose-600 hover:bg-rose-50"
              onClick={() => setIsClearDialogOpen(true)}
              disabled={!clearConfig && !clearTasks}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              清空所选数据
            </Button>
          </div>
        </div>
      </CardContent>

      {/* 清除确认 Dialog */}
      <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle>清空本地画廊数据</DialogTitle>
            <DialogDescription className="text-xs leading-5">
              确定要清空所选的本地画廊数据吗？包含：
              {clearConfig ? "【偏好配置】" : ""}
              {clearTasks ? "【所有任务和图片缓存】" : ""}。
              此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setIsClearDialogOpen(false)}>
              取消
            </Button>
            <Button
              className="rounded-xl bg-rose-600 text-white hover:bg-rose-700"
              onClick={handleClear}
              disabled={isClearing}
            >
              {isClearing ? <LoaderCircle className="mr-1.5 size-3.5 animate-spin" /> : null}
              确认清空
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
