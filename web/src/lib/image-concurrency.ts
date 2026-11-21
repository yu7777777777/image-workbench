/** Shared by settings hydration, validation, and the save payload. */
export const IMAGE_TASK_CONCURRENCY_ERROR = "单任务图片并发上限必须为 1–8 的整数";

export function parseImageTaskConcurrency(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : null;
}

export function normalizeImageConcurrency(config: {
  image_parallel_generation?: boolean;
  image_task_concurrency?: number | string;
}) {
  return {
    image_parallel_generation: config.image_parallel_generation ?? true,
    image_task_concurrency: parseImageTaskConcurrency(config.image_task_concurrency) ?? 2,
  };
}
