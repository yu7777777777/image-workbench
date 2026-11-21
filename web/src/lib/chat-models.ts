// Verified against upstream web intelligence_presets on 2026-10-08.
// Do not alias bare gpt-5-6 (Luna) or -wm models to Sol.
export const CHAT_FAMILIES = [
  { id: "gpt-6", label: "GPT-6" },
  { id: "gpt-5-6", label: "GPT-5.6 Sol" },
  { id: "gpt-5-5", label: "GPT-5.5" },
] as const;
export const CHAT_LEVELS = [
  { id: "instant", label: "即时", suffix: "instant", effort: "" },
  { id: "standard", label: "中", suffix: "thinking", effort: "standard" },
  { id: "extended", label: "高", suffix: "thinking", effort: "extended" },
  { id: "max", label: "极高 · Pro 账号", suffix: "thinking", effort: "max" },
  { id: "pro", label: "Pro", suffix: "pro", effort: "" },
] as const;
export function chatSelection(model: string, effort: string) {
  for (const family of CHAT_FAMILIES) {
    const level = CHAT_LEVELS.find(
      (item) => model === `${family.id}-${item.suffix}` && effort === item.effort,
    );
    if (level) return { family: family.id, level: level.id };
  }
  return null;
}
export function chatChoice(family: string, level: string) {
  const group = CHAT_FAMILIES.find((item) => item.id === family);
  const preset = CHAT_LEVELS.find((item) => item.id === level);
  if (!group || !preset) return null;
  return { model: `${group.id}-${preset.suffix}`, effort: preset.effort };
}
export function chatModelLabel(model: string): string {
  const family = CHAT_FAMILIES.find((item) =>
    CHAT_LEVELS.some((level) => model === `${item.id}-${level.suffix}`),
  );
  return family?.label || (model === "auto" ? "自动选择" : model);
}
