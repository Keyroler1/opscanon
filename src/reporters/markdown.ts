import type { AuditReport, Finding, McpScanResult } from '../types.js'

const CATEGORY_LABELS: Record<keyof AuditReport['categories'], string> = {
  agentSetupDocs: 'Agent-facing setup/docs',
  machineInterfaces: 'Machine interfaces',
  repoContextQuality: 'Repo context quality',
  evalReproducibility: 'Eval/test reproducibility',
  mcpSecurityBoundaries: 'MCP/security boundaries'
}

export function renderMarkdownReport(report: AuditReport, mcpResults: McpScanResult[] = []): string {
  const categoryRows = Object.entries(report.categories)
    .map(([key, value]) => `| ${CATEGORY_LABELS[key as keyof AuditReport['categories']]} | ${value.score}/100 | ${Math.round(value.weight * 100)}% |`)
    .join('\n')

  const topFixes = report.topFixes.length > 0
    ? report.topFixes.map((finding, index) => `${index + 1}. **${finding.title}** (${finding.severity})${finding.path ? ` in \`${finding.path}\`` : ''}: ${finding.recommendation}`).join('\n')
    : 'No high-impact fixes detected.'

  const mcpSection = mcpResults.length > 0
    ? mcpResults.map(renderMcpResult).join('\n\n')
    : 'No MCP targets were scanned separately.'

  return `# RepoHandoff Report

**Repository:** ${report.repo.name}
**Overall score:** ${report.overallScore}/100

## Scorecard

| Category | Score | Weight |
|---|---:|---:|
${categoryRows}

## Top Fixes

${topFixes}

## Detected Interfaces

- Languages: ${formatList(report.signals.languages)}
- CLI entrypoints: ${formatList(report.signals.cliEntrypoints)}
- OpenAPI specs: ${formatList(report.signals.openApiFiles)}
- MCP files: ${formatList(report.signals.mcpConfigFiles)}
- Test commands: ${formatList(report.signals.testCommands)}
- CI files: ${formatList(report.signals.ciFiles)}

## MCP Review

${mcpSection}
`
}

export function renderMcpMarkdown(results: McpScanResult[]): string {
  if (results.length === 0) {
    return '# MCP Review\n\nNo MCP targets found.\n'
  }

  return `# MCP Review

${results.map(renderMcpResult).join('\n\n')}
`
}

function renderMcpResult(result: McpScanResult): string {
  const findings = result.findings.length > 0
    ? result.findings.map(renderFinding).join('\n')
    : '- No MCP risks detected.'

  return `### ${result.target}

- Target type: ${result.targetType}
- Risk score: ${result.riskScore}/100

${findings}`
}

function renderFinding(finding: Finding): string {
  return `- **${finding.title}** (${finding.severity}): ${finding.recommendation}`
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(', ') : 'none detected'
}
