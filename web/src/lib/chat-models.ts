// Verified against upstream web intelligence_presets on 2026-10-08.
// Do not alias bare gpt-5-6 (Luna) or -wm models to Sol.
export const CHAT_FAMILIES = [
  { id: "gpt-6", label: "GPT-6" },
  { id: "gpt-5-6", label: "GPT-5.6" },
  { id: "gpt-5-5", label: "GPT-5.5" },
] as const;
export const CHAT_LEVELS = [
  { id: "instant", label: "即时", suffix: "instant", effort: "" },
  { id: "standard", label: "中", suffix: "thinking", effort: "standard" },
  { id: "extended", label: "高", suffix: "thinking", effort: "extended" },
  { id: "max", label: "极高 · Pro 账号", suffix: "thinking", effort: "max" },
  { id: "pro", label: "Pro", suffix: "pro", effort: "" },
] as const;

type AvailableModels = readonly string[];

export function chatFamilies(models: AvailableModels) {
  const families = new Map<string, string>();
  for (const model of models) {
    const family = CHAT_FAMILIES.find(({ id }) =>
      model === id || CHAT_LEVELS.some(({ suffix }) => model === `${id}-${suffix}`),
    );
    const id = family?.id ?? model;
    families.set(id, chatModelLabel(id));
  }
  return [...families].map(([id, label]) => ({ id, label }));
}

function exactModel(family: string, level: string): string | null {
  const preset = CHAT_LEVELS.find((item) => item.id === level);
  return preset ? `${family}-${preset.suffix}` : null;
}

function familyModelAvailable(family: string, models: AvailableModels): boolean {
  return models.includes(family);
}

export function chatLevelAvailable(
  family: string,
  level: string,
  models: AvailableModels,
): boolean {
  if (!CHAT_FAMILIES.some(({ id }) => id === family)) {
    return level === "instant" && models.includes(family);
  }
  const exact = exactModel(family, level);
  if (!exact || level === "max") return false;
  if (models.includes(exact)) return true;
  return level !== "pro" && familyModelAvailable(family, models);
}

export function chatSelection(model: string, effort: string) {
  for (const family of CHAT_FAMILIES) {
    const level = CHAT_LEVELS.find(
      (item) => model === `${family.id}-${item.suffix}` && effort === item.effort,
    );
    if (level) return { family: family.id, level: level.id };
    if (model === family.id) {
      const baseLevel = CHAT_LEVELS.find((item) => item.effort === effort);
      if (baseLevel && baseLevel.id !== "pro") {
        return { family: family.id, level: baseLevel.id };
      }
    }
  }
  return model && !effort ? { family: model, level: "instant" as const } : null;
}
export function chatChoice(
  family: string,
  level: string,
  models?: AvailableModels,
) {
  const group = CHAT_FAMILIES.find((item) => item.id === family);
  const preset = CHAT_LEVELS.find((item) => item.id === level);
  if (!preset) return null;
  if (!group) return level === "instant" && models?.includes(family) ? { model: family, effort: "" } : null;
  if (models && chatLevelAvailable(family, level, models)) {
    return {
      model: models.includes(`${family}-${preset.suffix}`)
        ? `${family}-${preset.suffix}`
        : family,
      effort: preset.effort,
    };
  }
  return { model: `${group.id}-${preset.suffix}`, effort: preset.effort };
}
export function chatModelLabel(model: string): string {
  const family = CHAT_FAMILIES.find((item) =>
    model === item.id || CHAT_LEVELS.some((level) => model === `${item.id}-${level.suffix}`),
  );
  return family?.label || (model === "auto" ? "自动选择" : model);
}
