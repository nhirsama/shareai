import type { AccountType, AdminDataAccount } from '@/types'

export type CredentialImportPlatform = 'anthropic' | 'gemini' | 'antigravity'

export interface ImportFileInput {
  filename: string
  content: string
}

export interface ParseResult {
  accounts: AdminDataAccount[]
  errors: { filename: string; message: string }[]
  skipped: number
  totalErrors: number
}

const MAX_NAME_LENGTH = 100
const MAX_ERRORS_REPORTED = 100

export function parseImportFiles(
  files: ImportFileInput[],
  platform: CredentialImportPlatform,
  type: AccountType
): ParseResult {
  const accounts: AdminDataAccount[] = []
  const errors: { filename: string; message: string }[] = []
  let skipped = 0
  let totalErrors = 0

  for (const file of files) {
    try {
      const { entries, skippedLines } = parseFileContent(file.content)
      if (entries.length === 0 && skippedLines === 0) {
        totalErrors++
        pushError(errors, file.filename, 'Empty or no parseable JSON entries')
        continue
      }
      if (skippedLines > 0) {
        totalErrors += skippedLines
        pushError(errors, file.filename, `${skippedLines} line(s) skipped (invalid JSON)`)
      }
      for (const entry of entries) {
        const result = normalizeEntry(entry, platform, type, file.filename)
        if (result.account) {
          accounts.push(result.account)
        } else {
          skipped++
          if (result.reason) {
            totalErrors++
            pushError(errors, file.filename, result.reason)
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Parse error'
      totalErrors++
      pushError(errors, file.filename, msg)
    }
  }

  return { accounts, errors, skipped, totalErrors }
}

function pushError(errors: { filename: string; message: string }[], filename: string, message: string) {
  if (errors.length < MAX_ERRORS_REPORTED) {
    errors.push({ filename, message })
  }
}

interface FileParseResult {
  entries: unknown[]
  skippedLines: number
}

function parseFileContent(content: string): FileParseResult {
  const trimmed = content.trim()
  if (!trimmed) return { entries: [], skippedLines: 0 }

  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed)
    if (Array.isArray(arr)) return { entries: arr, skippedLines: 0 }
    return { entries: [arr], skippedLines: 0 }
  }

  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed)
      if (Array.isArray(obj)) return { entries: obj, skippedLines: 0 }
      return { entries: [obj], skippedLines: 0 }
    } catch {
      return parseJsonLines(trimmed)
    }
  }

  return parseJsonLines(trimmed)
}

function parseJsonLines(content: string): FileParseResult {
  const results: unknown[] = []
  let skippedLines = 0
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      results.push(JSON.parse(trimmed))
    } catch {
      skippedLines++
    }
  }
  return { entries: results, skippedLines }
}

interface NormalizeResult {
  account: AdminDataAccount | null
  reason?: string
}

function normalizeEntry(
  entry: unknown,
  platform: CredentialImportPlatform,
  type: AccountType,
  filename: string
): NormalizeResult {
  if (typeof entry !== 'object' || entry === null) {
    return { account: null, reason: 'Entry is not a JSON object' }
  }
  const obj = entry as Record<string, unknown>

  const credentials = extractCredentials(obj, platform, type)
  if (!credentials) {
    const name = extractName(obj) || filenameWithoutExt(filename)
    return { account: null, reason: `${name}: missing required credential fields` }
  }

  const rawName = extractName(obj) || filenameWithoutExt(filename)
  const name = rawName.length > MAX_NAME_LENGTH ? rawName.substring(0, MAX_NAME_LENGTH) : rawName

  return {
    account: {
      name,
      platform,
      type,
      credentials,
      extra: { import_source: 'batch_import', imported_at: new Date().toISOString() },
      concurrency: 3,
      priority: 50
    }
  }
}

function extractCredentials(
  obj: Record<string, unknown>,
  platform: CredentialImportPlatform,
  type: AccountType
): Record<string, unknown> | null {
  // Also try credentials sub-object (from project's own export format)
  const credObj = (typeof obj.credentials === 'object' && obj.credentials !== null)
    ? obj.credentials as Record<string, unknown>
    : null

  if (type === 'apikey') {
    return extractApiKeyCredentials(obj, credObj)
  }

  switch (platform) {
    case 'anthropic':
      return extractAnthropicCredentials(obj, credObj, type)
    case 'gemini':
      return extractGeminiCredentials(obj, credObj)
    case 'antigravity':
      return extractAntigravityCredentials(obj, credObj)
    default:
      return null
  }
}

function extractAnthropicCredentials(
  obj: Record<string, unknown>,
  credObj: Record<string, unknown> | null,
  type: AccountType
): Record<string, unknown> | null {
  if (type === 'setup-token') {
    const token = getNestedString(obj, ['setup_token'], ['setupToken'], ['token'], ['access_token'], ['accessToken'])
      || (credObj && getNestedString(credObj, ['access_token']))
    if (!token) return null
    return { access_token: token }
  }

  const accessToken = getNestedString(obj,
    ['access_token'], ['accessToken'], ['sessionKey'], ['session_key'], ['token']
  ) || (credObj && getNestedString(credObj, ['access_token']))
  if (!accessToken) return null

  const creds: Record<string, unknown> = { access_token: accessToken }
  const refreshToken = getNestedString(obj, ['refresh_token'], ['refreshToken'])
    || (credObj && getNestedString(credObj, ['refresh_token']))
  if (refreshToken) creds.refresh_token = refreshToken

  const orgId = getNestedString(obj, ['organization_id'], ['organizationId'], ['org_id'])
    || (credObj && getNestedString(credObj, ['organization_id']))
  if (orgId) creds.organization_id = orgId

  return creds
}

function extractGeminiCredentials(
  obj: Record<string, unknown>,
  credObj: Record<string, unknown> | null
): Record<string, unknown> | null {
  const accessToken = getNestedString(obj, ['access_token'], ['accessToken'], ['token'])
    || (credObj && getNestedString(credObj, ['access_token']))
  if (!accessToken) return null

  const creds: Record<string, unknown> = { access_token: accessToken }
  const refreshToken = getNestedString(obj, ['refresh_token'], ['refreshToken'])
    || (credObj && getNestedString(credObj, ['refresh_token']))
  if (refreshToken) creds.refresh_token = refreshToken

  return creds
}

function extractAntigravityCredentials(
  obj: Record<string, unknown>,
  credObj: Record<string, unknown> | null
): Record<string, unknown> | null {
  const accessToken = getNestedString(obj, ['access_token'], ['accessToken'], ['token'])
    || (credObj && getNestedString(credObj, ['access_token']))
  if (!accessToken) return null

  const creds: Record<string, unknown> = { access_token: accessToken }
  const refreshToken = getNestedString(obj, ['refresh_token'], ['refreshToken'])
    || (credObj && getNestedString(credObj, ['refresh_token']))
  if (refreshToken) creds.refresh_token = refreshToken

  const cookie = getNestedString(obj, ['cookie'])
    || (credObj && getNestedString(credObj, ['cookie']))
  if (cookie) creds.cookie = cookie

  return creds
}

function extractApiKeyCredentials(
  obj: Record<string, unknown>,
  credObj: Record<string, unknown> | null
): Record<string, unknown> | null {
  const key = getNestedString(obj, ['api_key'], ['apiKey'], ['key'], ['token'])
    || (credObj && getNestedString(credObj, ['api_key']))
  if (!key) return null
  return { api_key: key }
}

function extractName(obj: Record<string, unknown>): string {
  return (
    getNestedString(obj, ['name']) ||
    getNestedString(obj, ['username']) ||
    getNestedString(obj, ['user', 'name']) ||
    getNestedString(obj, ['email']) ||
    getNestedString(obj, ['user', 'email']) ||
    ''
  )
}

function getNestedString(obj: Record<string, unknown>, ...paths: string[][]): string {
  for (const path of paths) {
    const val = getByPath(obj, path)
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  return ''
}

function getByPath(obj: unknown, path: string[]): unknown {
  let current: unknown = obj
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function filenameWithoutExt(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  return lastDot > 0 ? filename.substring(0, lastDot) : filename
}
