import { join } from 'node:path'
import type { AuditReport, Finding, McpScanResult, RepoSignals, ScoreCategory } from './types.js'

const VERSION = '0.1.0'

const CATEGORY_WEIGHTS = {
  agentSetupDocs: 0.25,
  machineInterfaces: 0.25,
  repoContextQuality: 0.2,
  evalReproducibility: 0.15,
  mcpSecurityBoundaries: 0.15
} as const

export function calculateScorecard(signals: RepoSignals, mcpResults: McpScanResult[] = []): AuditReport {
  const categories = {
    agentSetupDocs: category(scoreAgentSetupDocs(signals), CATEGORY_WEIGHTS.agentSetupDocs, signals.findings, 'docs.'),
    machineInterfaces: category(scoreMachineInterfaces(signals), CATEGORY_WEIGHTS.machineInterfaces, signals.findings, 'interfaces.'),
    repoContextQuality: category(scoreRepoContext(signals), CATEGORY_WEIGHTS.repoContextQuality, signals.findings, 'context.'),
    evalReproducibility: category(scoreEvalReproducibility(signals), CATEGORY_WEIGHTS.evalReproducibility, signals.findings, 'evals.'),
    mcpSecurityBoundaries: category(scoreMcpSecurity(signals, mcpResults), CATEGORY_WEIGHTS.mcpSecurityBoundaries, [
      ...signals.findings,
      ...mcpResults.flatMap((result) => result.findings)
    ], 'security.', 'secret.', 'mcp.')
  }

  const overallScore = Math.round(
    Object.values(categories).reduce((total, current) => total + current.score * current.weight, 0)
  )

  const topFixes = sortFindings([
    ...signals.findings,
    ...mcpResults.flatMap((result) => result.findings)
  ]).slice(0, 8)

  const { rootPath: _rootPath, secretFindings: _secretFindings, ...safeSignals } = signals

  return {
    tool: 'repohandoff',
    version: VERSION,
    generatedAt: new Date().toISOString(),
    repo: {
      name: signals.repoName,
      path: signals.rootPath
    },
    overallScore,
    categories,
    topFixes,
    signals: safeSignals
  }
}

export function reportOutputPaths(outDir: string): { markdown: string; json: string } {
  return {
    markdown: join(outDir, 'repohandoff-report.md'),
    json: join(outDir, 'repohandoff-report.json')
  }
}

function category(score: number, weight: number, findings: Finding[], ...prefixes: string[]): ScoreCategory {
  return {
    score: clamp(score),
    weight,
    findings: findings.filter((finding) => prefixes.some((prefix) => finding.code.startsWith(prefix)))
  }
}

function scoreAgentSetupDocs(signals: RepoSignals): number {
  return sum([
    [signals.hasReadme, 30],
    [signals.hasSetupDocs, 25],
    [signals.hasUsageDocs, 20],
    [signals.hasAgentDocs, 15],
    [signals.envExampleFiles.length > 0, 10]
  ])
}

function scoreMachineInterfaces(signals: RepoSignals): number {
  return sum([
    [signals.hasCli, 35],
    [signals.hasOpenApi || signals.hasApiDocs, 25],
    [signals.hasMcpDependency || signals.mcpConfigFiles.length > 0, 25],
    [signals.hasUsageDocs, 15]
  ])
}

function scoreRepoContext(signals: RepoSignals): number {
  return sum([
    [signals.manifests.length > 0, 20],
    [signals.languages.length > 0, 15],
    [signals.hasAgentInstructions, 25],
    [signals.docsFiles.length > 0, 20],
    [signals.envExampleFiles.length > 0, 10],
    [signals.hasCi, 10]
  ])
}

function scoreEvalReproducibility(signals: RepoSignals): number {
  return sum([
    [signals.testCommands.length > 0, 45],
    [signals.hasCi, 25],
    [signals.buildCommands.length > 0, 15],
    [signals.lintCommands.length > 0, 15]
  ])
}

function scoreMcpSecurity(signals: RepoSignals, mcpResults: McpScanResult[]): number {
  const maxMcpRisk = Math.max(0, ...mcpResults.map((result) => result.riskScore))
  const secretPenalty = signals.secretFindings.length > 0 ? 45 : 0
  const mcpPenalty = Math.min(55, Math.round(maxMcpRisk * 0.55))
  const envBonus = signals.envExampleFiles.length > 0 ? 10 : 0
  return 90 + envBonus - secretPenalty - mcpPenalty
}

function sum(items: Array<[boolean, number]>): number {
  return items.reduce((total, [condition, points]) => (condition ? total + points : total), 0)
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}

function sortFindings(findings: Finding[]): Finding[] {
  const severityRank = { high: 0, medium: 1, low: 2, info: 3 }
  return [...findings].sort((a, b) => {
    const severity = severityRank[a.severity] - severityRank[b.severity]
    if (severity !== 0) return severity
    return a.code.localeCompare(b.code)
  })
}
