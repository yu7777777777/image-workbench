import type { AgentSkill } from '../types'

export const AGENT_SKILL_NAME_LIMIT = 60
export const AGENT_SKILL_TEXT_LIMIT = 16000
export const AGENT_SKILL_FILE_LIMIT = 64000

export function normalizeAgentSkill(value: unknown): AgentSkill | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { name, instructions } = value as Partial<AgentSkill>
  if (typeof name !== 'string' || typeof instructions !== 'string') return undefined
  const trimmedName = name.trim()
  const trimmedInstructions = instructions.trim()
  if (!trimmedName || trimmedName.length > AGENT_SKILL_NAME_LIMIT) return undefined
  if (!trimmedInstructions || trimmedInstructions.length > AGENT_SKILL_TEXT_LIMIT) return undefined
  return { name: trimmedName, instructions: trimmedInstructions }
}

export function readAgentSkillMarkdown(source: string, fallbackName: string): AgentSkill {
  const normalized = source.trim().replace(/\r\n?/g, '\n')
  const frontMatter = normalized.match(/^---[^\S\n]*\n([\s\S]*?)\n---[^\S\n]*(?:\n|$)/)
  const instructions = normalized.slice(frontMatter?.[0].length ?? 0).trim()
  const declaredName = frontMatter?.[1].match(/^name:[ \t]*(.+)$/m)?.[1].trim()
  const heading = instructions.match(/^#\s+([^\n]+)/m)?.[1].trim()
  const name = declaredName?.replace(/^(['"])(.*)\1$/, '$2') || heading || fallbackName.replace(/\.md$/i, '')
  return { name: name.trim().slice(0, AGENT_SKILL_NAME_LIMIT), instructions }
}
