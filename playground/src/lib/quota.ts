export interface HealthStats {
  status: string
  healthy: boolean
  accounts?: {
    total: number
    active: number
    total_quota: number
    quota_by_model?: Record<string, number>
    quota_by_type?: Record<string, number>
  }
}

export interface QuotaData {
  totalQuota: number
  quotaByModel: Record<string, number>
}

export async function fetchQuotaData(): Promise<QuotaData | null> {
  try {
    const res = await fetch('/health?format=json', {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    })
    if (!res.ok) return null
    const data = (await res.json()) as HealthStats
    if (data?.accounts && typeof data.accounts.total_quota === 'number') {
      return {
        totalQuota: data.accounts.total_quota,
        quotaByModel: data.accounts.quota_by_model || {},
      }
    }
    return null
  } catch {
    return null
  }
}

export async function fetchTotalQuota(): Promise<number | null> {
  const data = await fetchQuotaData()
  return data ? data.totalQuota : null
}
