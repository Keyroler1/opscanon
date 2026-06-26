const SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /gh[pousr]_[A-Za-z0-9_]{12,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g
]

const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:api[_-]?key|token|secret|password|credential)[A-Z0-9_]*)\b["']?\s*[:=]\s*["']?([^"',\s}]{8,})/gi

const PLACEHOLDER_VALUES = new Set([
  'changeme',
  'change-me',
  'example',
  'placeholder',
  'your-api-key',
  'your-token',
  'replace-me',
  '<token>',
  '<secret>'
])

export function redactSecrets(value: string): string {
  let redacted = value.replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}: [REDACTED]`)

  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]')
  }

  return redacted
}

export function isLikelySecretValue(value: string): boolean {
  const normalized = value.trim().replace(/^["']|["']$/g, '')
  if (normalized.length < 8) {
    return false
  }

  if (PLACEHOLDER_VALUES.has(normalized.toLowerCase())) {
    return false
  }

  if (/^\$\{?[A-Z0-9_]+\}?$/.test(normalized)) {
    return false
  }

  return SECRET_VALUE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(normalized)
  }) || /[A-Za-z0-9_-]{20,}/.test(normalized)
}

export function findSecretAssignments(content: string): Array<{ key: string; index: number }> {
  const matches: Array<{ key: string; index: number }> = []
  const pattern = new RegExp(SECRET_ASSIGNMENT_PATTERN)
  let match = pattern.exec(content)

  while (match) {
    const key = match[1]
    const value = match[2]
    if (isLikelySecretValue(value)) {
      matches.push({ key, index: match.index })
    }
    match = pattern.exec(content)
  }

  return matches
}
