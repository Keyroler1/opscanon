import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Finding, McpScanResult } from '../types.js'
import { pathExists, readTextFile } from '../utils/files.js'
import { findSecretAssignments, isLikelySecretValue } from '../utils/redaction.js'

interface McpConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  tools?: Array<{
    name?: string
    description?: string
    inputSchema?: unknown
  }>
}

export async function scanMcpTarget(target: string): Promise<McpScanResult> {
  if (await isFileTarget(target)) {
    return scanMcpConfigFile(target)
  }

  return scanMcpCommand(target)
}

async function scanMcpConfigFile(target: string): Promise<McpScanResult> {
  const content = await readTextFile(target)
  const findings: Finding[] = []

  for (const secret of findSecretAssignments(content)) {
    findings.push({
      code: 'mcp.direct-secret',
      title: 'Direct secret in MCP config',
      severity: 'high',
      message: `MCP config contains a direct value for "${secret.key}". The value was redacted from this report.`,
      path: basename(target),
      recommendation: 'Reference an environment variable instead of storing token values in MCP config.'
    })
  }

  const parsed = parseJsonMcpConfig(content)
  if (parsed) {
    findings.push(...inspectCommand(parsed.command, parsed.args ?? [], 'mcp.shell-command'))
    findings.push(...inspectEnv(parsed.env ?? {}))
    findings.push(...inspectTools(parsed.tools ?? []))
  } else {
    findings.push(...inspectTextConfig(content))
  }

  return {
    target,
    targetType: 'config',
    riskScore: calculateMcpRisk(findings),
    findings
  }
}

async function scanMcpCommand(target: string): Promise<McpScanResult> {
  const findings: Finding[] = []
  findings.push(...inspectCommand(firstToken(target), target.split(/\s+/).slice(1), 'mcp.command-shell'))

  if (/(--token|--api-key|--secret)\s+\S+/i.test(target) || /sk-[A-Za-z0-9_-]{8,}/.test(target)) {
    findings.push({
      code: 'mcp.command-secret',
      title: 'Secret-like value in MCP command',
      severity: 'high',
      message: 'The MCP command string appears to include a token or secret value. The value was redacted from this report.',
      recommendation: 'Pass sensitive values through environment variables or a secret manager.'
    })
  }

  return {
    target,
    targetType: 'command',
    riskScore: calculateMcpRisk(findings),
    findings
  }
}

async function isFileTarget(target: string): Promise<boolean> {
  if (!(await pathExists(target))) {
    return false
  }

  return (await stat(target)).isFile()
}

function parseJsonMcpConfig(content: string): McpConfig | undefined {
  try {
    return JSON.parse(content) as McpConfig
  } catch {
    return undefined
  }
}

function inspectEnv(env: Record<string, string>): Finding[] {
  return Object.entries(env)
    .filter(([, value]) => isLikelySecretValue(value))
    .map(([key]) => ({
      code: 'mcp.direct-secret',
      title: 'Direct secret in MCP environment',
      severity: 'high' as const,
      message: `MCP environment variable "${key}" contains a direct secret-like value. The value was redacted from this report.`,
      recommendation: 'Use an env var reference in config and store the secret outside source control.'
    }))
}

function inspectCommand(command = '', args: string[] = [], code: string): Finding[] {
  const findings: Finding[] = []
  const normalizedCommand = command.toLowerCase()
  const normalizedArgs = args.join(' ').toLowerCase()
  const shellCommands = new Set(['bash', 'sh', 'cmd', 'cmd.exe', 'powershell', 'pwsh'])

  if (shellCommands.has(normalizedCommand)) {
    findings.push({
      code,
      title: 'Shell command used for MCP server',
      severity: 'high',
      message: `MCP server starts through "${command}", which expands the blast radius of prompt-injected arguments.`,
      recommendation: 'Prefer launching a fixed executable directly and avoid shell interpolation.'
    })
  }

  if (/rm\s+-rf|del\s+\/|format\s+|curl\s+.*\|\s*(bash|sh)|&&|\|\|/.test(normalizedArgs)) {
    findings.push({
      code: 'mcp.shell-command',
      title: 'Risky shell behavior in MCP args',
      severity: 'high',
      message: 'MCP arguments include shell chaining, destructive operations, or pipe-to-shell behavior.',
      recommendation: 'Move setup logic out of MCP startup args and use a minimal fixed command.'
    })
  }

  return findings
}

function inspectTextConfig(content: string): Finding[] {
  const findings: Finding[] = []
  if (/\b(bash|sh|powershell|cmd\.exe?)\b/i.test(content)) {
    findings.push({
      code: 'mcp.shell-command',
      title: 'Shell command referenced in MCP config',
      severity: 'medium',
      message: 'Text config references shell startup behavior that should be reviewed.',
      recommendation: 'Prefer direct executable startup and documented permission boundaries.'
    })
  }

  return findings
}

function inspectTools(tools: NonNullable<McpConfig['tools']>): Finding[] {
  const findings: Finding[] = []

  for (const tool of tools) {
    const description = tool.description?.trim() ?? ''
    const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : undefined
    if (description.length < 20 || /^(does stuff|do stuff|tool|helper)$/i.test(description)) {
      findings.push({
        code: 'mcp.vague-tool-description',
        title: 'Vague MCP tool description',
        severity: 'medium',
        message: `Tool "${tool.name ?? 'unknown'}" has a vague or missing description.`,
        recommendation: 'Describe what the tool does, its side effects, required permissions, and safe input boundaries.'
      })
    }

    if (!schema || Object.keys(schema).length === 0) {
      findings.push({
        code: 'mcp.missing-input-schema',
        title: 'Missing MCP input schema',
        severity: 'medium',
        message: `Tool "${tool.name ?? 'unknown'}" does not define a useful input schema.`,
        recommendation: 'Define a strict JSON schema so agents can validate inputs before calling the tool.'
      })
    }
  }

  return findings
}

function calculateMcpRisk(findings: Finding[]): number {
  const risk = findings.reduce((total, finding) => {
    if (finding.severity === 'high') return total + 35
    if (finding.severity === 'medium') return total + 20
    if (finding.severity === 'low') return total + 10
    return total + 3
  }, 0)

  return Math.min(100, risk)
}

function firstToken(value: string): string {
  return value.trim().split(/\s+/)[0] ?? ''
}
