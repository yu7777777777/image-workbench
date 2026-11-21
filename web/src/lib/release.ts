export type ReleaseInfo = {
  version: string;
  date: string;
  items: { type: string; content: string }[];
};

// 这些标记只记录构建与上线过程，不面向最终用户，展示时跳过。
const INTERNAL_ITEM_TYPES = new Set(["部署", "验证"]);

// 缺少 `[类型]` 前缀的历史条目也要保留，避免整段版本被静默丢弃。
const DEFAULT_ITEM_TYPE = "更新";

function cleanTitle(title: string): string {
  return title
    .replace(/[（(]\s*(本地未发布|已部署|未部署)\s*[)）]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 把更新说明里的反引号与 Markdown 强调符号去掉，避免在界面上显示为代码。 */
function cleanContent(content: string): string {
  return content
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim();
}

export function parseChangelog(content: string): ReleaseInfo[] {
  return content
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [title = "", ...lines] = block.trim().split("\n");
      const [, version = title.trim(), date = ""] =
        cleanTitle(title).match(/^(.+?)(?:\s+-\s+(.+))?$/) || [];
      // 面向用户的说明是二级标题；技术文档里的三级小标题只作为分组，不单独展示。
      const heading = version.trim();
      const items = lines
        .filter((line) => !line.trim().startsWith("### "))
        .map((line) => {
          const bullet = line.trim().match(/^[-+*]\s+(.+)$/);
          if (!bullet) return null;
          const body = bullet[1].trim();
          const tagged = body.match(/^\[(.+?)\]\s+(.+)$/);
          return tagged
            ? { type: tagged[1], content: cleanContent(tagged[2]) }
            : { type: DEFAULT_ITEM_TYPE, content: cleanContent(body) };
        })
        .filter((item): item is { type: string; content: string } => Boolean(item?.content))
        .filter((item) => !INTERNAL_ITEM_TYPES.has(item.type));
      // 说明文件里若用「修复：xxx」这种标题当版本名，无法作为版本号展示，直接丢弃。
      if (!/^v?\d+\.\d+/.test(heading)) return null;
      return { version: heading, date: date.trim(), items };
    })
    .filter((release): release is ReleaseInfo => Boolean(release && release.items.length));
}

/**
 * 读取面向用户的版本更新说明。
 *
 * 优先用 `RELEASE-NOTES.md`（只写用户能感知的变化）；缺失时回退到 `CHANGELOG.md`，
 * 保证历史上只有技术文档时弹窗依然有内容可显示。
 */
export function readReleases(
  readFile: (path: string) => string,
  notesPath: string,
  changelogPath: string,
): ReleaseInfo[] {
  for (const path of [notesPath, changelogPath]) {
    try {
      const releases = parseChangelog(readFile(path));
      if (releases.length) return releases;
    } catch {
      // 文件不存在或读取失败时继续尝试下一个来源。
    }
  }
  return [];
}
