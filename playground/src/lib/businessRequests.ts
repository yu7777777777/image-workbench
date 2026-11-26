import type { ApiProfile } from '../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxyForCredential } from './devProxy'

const operationPaths = {
  generate_image: 'images/generations',
  edit_image: 'images/edits',
  complete_text: 'chat/completions',
  run_agent: 'responses',
} as const

export function businessRequestUrl(profile: ApiProfile, operation: keyof typeof operationPaths): string {
  const proxy = readClientDevProxyConfig()
  return buildApiUrl(
    profile.baseUrl, operationPaths[operation], proxy,
    shouldUseApiProxyForCredential(profile.apiKey, profile.apiProxy, proxy),
  )
}
