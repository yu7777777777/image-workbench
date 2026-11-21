const SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/
const RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)\s*$/
const SIZE_MULTIPLE = 16
const MAX_EDGE = 3840
const MAX_ASPECT_RATIO = 3
const MIN_PIXELS = 655_360
const MAX_PIXELS = 8_294_400
const MAX_1K_PIXELS = 1_572_864

// 上游只按约 157 万像素生成，方形上限 1254×1254，2K/4K 无法原生实现，
// 因此档位收敛为单一的 1K（即上游原生画质），避免输出放大的模糊图。
export type SizeTier = '1K'
type PresetRatio = '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9'

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

function floorToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.floor(value / multiple) * multiple)
}

function ceilToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.ceil(value / multiple) * multiple)
}

function normalizeDimensions(width: number, height: number) {
  let normalizedWidth = roundToMultiple(width, SIZE_MULTIPLE)
  let normalizedHeight = roundToMultiple(height, SIZE_MULTIPLE)

  const scaleToFit = (scale: number) => {
    normalizedWidth = floorToMultiple(normalizedWidth * scale, SIZE_MULTIPLE)
    normalizedHeight = floorToMultiple(normalizedHeight * scale, SIZE_MULTIPLE)
  }

  const scaleToFill = (scale: number) => {
    normalizedWidth = ceilToMultiple(normalizedWidth * scale, SIZE_MULTIPLE)
    normalizedHeight = ceilToMultiple(normalizedHeight * scale, SIZE_MULTIPLE)
  }

  for (let i = 0; i < 4; i++) {
    const maxEdge = Math.max(normalizedWidth, normalizedHeight)
    if (maxEdge > MAX_EDGE) {
      scaleToFit(MAX_EDGE / maxEdge)
    }

    if (normalizedWidth / normalizedHeight > MAX_ASPECT_RATIO) {
      normalizedWidth = floorToMultiple(normalizedHeight * MAX_ASPECT_RATIO, SIZE_MULTIPLE)
    } else if (normalizedHeight / normalizedWidth > MAX_ASPECT_RATIO) {
      normalizedHeight = floorToMultiple(normalizedWidth * MAX_ASPECT_RATIO, SIZE_MULTIPLE)
    }

    const pixels = normalizedWidth * normalizedHeight
    if (pixels > MAX_PIXELS) {
      scaleToFit(Math.sqrt(MAX_PIXELS / pixels))
    } else if (pixels < MIN_PIXELS) {
      scaleToFill(Math.sqrt(MIN_PIXELS / pixels))
    }
  }

  return { width: normalizedWidth, height: normalizedHeight }
}

export function normalizeImageSize(size: string) {
  const trimmed = size.trim()
  const match = trimmed.match(SIZE_PATTERN)
  if (!match) return trimmed

  const { width, height } = normalizeDimensions(Number(match[1]), Number(match[2]))
  return `${width}x${height}`
}

export function normalizeCodexCliImageSize(size: string) {
  const trimmed = size.trim()
  const match = trimmed.match(SIZE_PATTERN)
  if (!match) return trimmed

  const originalWidth = Number(match[1])
  const originalHeight = Number(match[2])
  const normalized = normalizeDimensions(originalWidth, originalHeight)
  if (normalized.width * normalized.height > MAX_1K_PIXELS) {
    return calculateImageSize('1K', `${normalized.width}:${normalized.height}`) ?? `${normalized.width}x${normalized.height}`
  }

  const { width, height } = normalized
  return `${width}x${height}`
}

export function prependCodexCliSizePrompt(prompt: string, size: string) {
  if (size === 'auto') return prompt
  const trimmed = prompt.trimStart()
  const hint = `Generate at ${size} resolution.`
  if (trimmed.startsWith(hint)) return trimmed
  return `${hint} ${trimmed}`
}

export function stripInjectedCodexCliSizePrompt(prompt: string, originalPrompt: string, size: string) {
  if (size === 'auto') return prompt
  const prefix = `Generate at ${size} resolution.`
  if (originalPrompt.trimStart().startsWith(prefix)) return prompt
  const trimmed = prompt.trimStart()
  if (!trimmed.startsWith(prefix)) return prompt
  return trimmed.slice(prefix.length).trimStart()
}

export function parseRatio(ratio: string) {
  const match = ratio.match(RATIO_PATTERN)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

export function formatImageRatio(width: number, height: number) {
  const roundedWidth = Math.round(width)
  const roundedHeight = Math.round(height)
  if (
    !Number.isFinite(roundedWidth) ||
    !Number.isFinite(roundedHeight) ||
    roundedWidth <= 0 ||
    roundedHeight <= 0
  ) {
    return ''
  }

  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const divisor = gcd(roundedWidth, roundedHeight)
  const simplifiedWidth = roundedWidth / divisor
  const simplifiedHeight = roundedHeight / divisor
  const simplified = `${simplifiedWidth}:${simplifiedHeight}`
  const commonRatios = [
    [1, 1],
    [4, 3],
    [3, 4],
    [3, 2],
    [2, 3],
    [16, 9],
    [9, 16],
    [21, 9],
    [9, 21],
  ]

  for (const [commonWidth, commonHeight] of commonRatios) {
    if (simplifiedWidth === commonWidth && simplifiedHeight === commonHeight) {
      return simplified
    }
  }

  const actualRatio = roundedWidth / roundedHeight
  const squareDelta = Math.abs(actualRatio - 1)
  if (squareDelta <= 0.18) return '≈1:1'

  const nearest = commonRatios
    .map(([commonWidth, commonHeight]) => {
      const ratio = commonWidth / commonHeight
      return {
        label: `${commonWidth}:${commonHeight}`,
        delta: Math.abs(actualRatio - ratio) / ratio,
      }
    })
    .sort((a, b) => a.delta - b.delta)[0]

  if (nearest && nearest.delta <= 0.01) return `≈${nearest.label}`

  const friendlyNearest = Array.from({ length: 12 }, (_, widthIndex) => widthIndex + 1)
    .flatMap((friendlyWidth) =>
      Array.from({ length: 12 }, (_, heightIndex) => heightIndex + 1).map((friendlyHeight) => {
        const ratio = friendlyWidth / friendlyHeight
        const delta = Math.abs(actualRatio - ratio) / ratio
        return {
          label: `${friendlyWidth}:${friendlyHeight}`,
          delta,
          // 在误差接近时偏向更短、更好读的比例，例如 7:6 优于 8:7。
          score: delta + (friendlyWidth + friendlyHeight) * 0.002,
        }
      }),
    )
    .filter((item) => item.label !== simplified)
    .sort((a, b) => a.score - b.score)[0]

  return friendlyNearest && friendlyNearest.delta <= 0.04 ? `≈${friendlyNearest.label}` : simplified
}

/**
 * 每个档位的像素预算上限。
 * 在该预算内、满足所有 OpenAI 约束的前提下，选取总像素最大的候选尺寸。
 */
const TIER_PIXEL_BUDGET: Record<SizeTier, number> = {
  '1K': MAX_1K_PIXELS, // 约 1254 × 1254，上游原生像素预算
}

/**
 * 常用比例优先使用官方示例或通用显示标准，避免按像素预算计算出不常见尺寸。
 * 其中 21:9 的常见显示器尺寸会按 16 倍数约束做轻微规整。
 */
const COMMON_SIZE_PRESETS: Record<SizeTier, Record<PresetRatio, string>> = {
  '1K': {
    // 1K 档即上游原生输出：方形固定 1254×1254，其余比例由上游按总像素预算适配。
    '1:1': '1254x1254',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1672x940',
    '9:16': '940x1672',
    '4:3': '1448x1086',
    '3:4': '1086x1448',
    '21:9': '1672x716',
  },

}

function getPresetRatioKey(ratioWidth: number, ratioHeight: number): PresetRatio | null {
  if (!Number.isInteger(ratioWidth) || !Number.isInteger(ratioHeight)) return null

  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const divisor = gcd(ratioWidth, ratioHeight)
  const key = `${ratioWidth / divisor}:${ratioHeight / divisor}`

  return key in COMMON_SIZE_PRESETS['1K'] ? key as PresetRatio : null
}

const MAX_RATIO_ERROR = 0.01

/** 展示用的常见比例档位（用于把实际像素归一到可读的比例名）。 */
const MODEL_RATIOS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
  '1:2', '2:1', '5:2', '1:4', '4:1', '1:8', '8:1', '1:16', '16:1', '9:19.5', '19.5:9', '9:20', '20:9',
].map((label) => {
  const [width, height] = label.split(':').map(Number)
  return { label, value: width / height }
})

/** 展示用的分辨率档位，按总像素的平方根划分。 */
const RESOLUTION_TIERS = [
  { label: '512', side: 512 },
  { label: '1K', side: 1024 },
  { label: '1.5K', side: 1536 },
  { label: '2K', side: 2048 },
  { label: '3K', side: 3072 },
  { label: '4K', side: 4096 },
]
const RATIO_TOLERANCE = 0.04

export function hasImageDimensions(
  value: { width?: number; height?: number } | null | undefined,
): value is { width: number; height: number } {
  const width = value?.width
  const height = value?.height
  return Number.isFinite(width) && Number.isFinite(height)
    && (width as number) > 0 && (height as number) > 0
}

function logDelta(a: number, b: number) {
  return Math.abs(Math.log(a / b))
}

function getClosestModelRatioLabel(ratio: number): string | null {
  let best: { label: string; delta: number } | null = null
  for (const item of MODEL_RATIOS) {
    const delta = logDelta(ratio, item.value)
    if (delta <= RATIO_TOLERANCE && (!best || delta < best.delta)) best = { label: item.label, delta }
  }
  return best?.label ?? null
}

/** 把实际像素归一到最接近的常见比例名，无法归一时给出 ≈ 形式的近似比例。 */
export function getImageRatioLabel(width: number, height: number): string {
  const closest = getClosestModelRatioLabel(width / height)
  return closest ?? formatImageRatio(width, height)
}

/** 按总像素的平方根归一到分辨率档位（同一像素尺寸的档位不随请求档位改变）。 */
export function getResolutionTierLabel(width: number, height: number): string {
  const side = Math.sqrt(width * height)
  let best = RESOLUTION_TIERS[0]
  let bestDelta = logDelta(side, best.side)
  for (const tier of RESOLUTION_TIERS.slice(1)) {
    const delta = logDelta(side, tier.side)
    if (delta < bestDelta) {
      best = tier
      bestDelta = delta
    }
  }
  return best.label
}

/**
 * 从请求的 size（WxH 或 auto）推导展示用比例/分辨率档位；
 * 本地 TaskParams 未单独存这两项，请求值统一从这里派生。
 */
export function getDerivedParamsFromSize(size: string): { aspect_ratio?: string; resolution?: string } {
  if (!size || size === 'auto') return {}
  const match = size.trim().match(SIZE_PATTERN)
  if (!match) return {}
  const width = Number(match[1])
  const height = Number(match[2])
  if (!(width > 0 && height > 0)) return {}
  return {
    aspect_ratio: getImageRatioLabel(width, height),
    resolution: getResolutionTierLabel(width, height),
  }
}

/** 实际出图的比例/分辨率档位（一律由真实像素决定）。 */
export function getActualRatioAndResolution(
  requestedSize: string | undefined,
  width: number,
  height: number,
): { aspect_ratio?: string; resolution?: string } {
  void requestedSize
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {}
  return {
    aspect_ratio: getImageRatioLabel(width, height),
    resolution: getResolutionTierLabel(width, height),
  }
}

export function calculateImageSize(tier: SizeTier, ratio: string) {
  const parsed = parseRatio(ratio)
  if (!parsed) return null

  const { width: ratioWidth, height: ratioHeight } = parsed
  const presetRatioKey = getPresetRatioKey(ratioWidth, ratioHeight)
  if (presetRatioKey) return COMMON_SIZE_PRESETS[tier][presetRatioKey]

  const targetRatio = ratioWidth / ratioHeight
  const pixelBudget = TIER_PIXEL_BUDGET[tier]

  let bestWidth = 0
  let bestHeight = 0
  let bestPixels = 0

  for (let w = SIZE_MULTIPLE; w <= MAX_EDGE; w += SIZE_MULTIPLE) {
    const idealH = w / targetRatio
    // 尝试 floor 和 ceil 对齐到 16 的倍数，取像素更大且合法的那个
    const candidates = [
      Math.floor(idealH / SIZE_MULTIPLE) * SIZE_MULTIPLE,
      Math.ceil(idealH / SIZE_MULTIPLE) * SIZE_MULTIPLE,
    ]

    for (const h of candidates) {
      if (h < SIZE_MULTIPLE || h > MAX_EDGE) continue

      const pixels = w * h
      if (pixels > pixelBudget || pixels < MIN_PIXELS) continue
      if (Math.max(w / h, h / w) > MAX_ASPECT_RATIO) continue

      const actualRatio = w / h
      const ratioError = Math.abs(actualRatio - targetRatio) / targetRatio
      if (ratioError > MAX_RATIO_ERROR) continue

      if (pixels > bestPixels) {
        bestPixels = pixels
        bestWidth = w
        bestHeight = h
      }
    }
  }

  if (bestPixels === 0) return null
  return `${bestWidth}x${bestHeight}`
}
