import { useEffect, useState } from 'react'
import { fetchCreative, type CreativeItem } from '../lib/creativeLibrary'

type PresetResult = { status: 'loading' | 'ready' | 'error'; items: CreativeItem[] }

export function useCreativePresets(kind: CreativeItem['kind'] | null) {
  const [result, setResult] = useState<PresetResult>({ status: 'loading', items: [] })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!kind) return
    const controller = new AbortController()
    setResult({ status: 'loading', items: [] })
    void fetchCreative<{ items: CreativeItem[] }>(`?kind=${kind}&favorites_only=true`, controller.signal)
      .then(({ items }) => {
        if (!controller.signal.aborted) setResult({ status: 'ready', items })
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ status: 'error', items: [] })
      })
    return () => controller.abort()
  }, [kind, attempt])
  return { ...result, retry: () => setAttempt((value) => value + 1) }
}
