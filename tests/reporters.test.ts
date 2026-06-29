import { describe, expect, it } from 'vitest'
import { scanRepository } from '../src/scanners/repo-scanner.js'
import { calculateScorecard } from '../src/scoring.js'
import { renderMarkdownReport, renderMcpMarkdown } from '../src/reporters/markdown.js'
import { copyFixture, makeTempDir, removeTempDir } from './helpers.js'

describe('report rendering', () => {
  it('renders stable markdown and JSON-safe reports without leaking secret values', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-report')
    try {
      const repo = await copyFixture('mcp-risky', tempDir)
      const report = calculateScorecard(await scanRepository(repo))
      const markdown = renderMarkdownReport(report)
      const json = JSON.stringify(report)

      expect(markdown).toContain('# OpsCanon Repo Readiness Report')
      expect(markdown).toContain('Overall score')
      expect(markdown).not.toContain('fake-risky-token-value-123456')
      expect(json).not.toContain('fake-risky-token-value-123456')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('renders MCP results with and without findings', () => {
    const markdown = renderMcpMarkdown([
      {
        target: 'safe',
        targetType: 'command',
        riskScore: 0,
        findings: []
      },
      {
        target: 'risky',
        targetType: 'config',
        riskScore: 35,
        findings: [
          {
            code: 'mcp.direct-secret',
            title: 'Direct secret',
            severity: 'high',
            message: 'Secret redacted.',
            recommendation: 'Use environment variables.'
          }
        ]
      }
    ])

    expect(markdown).toContain('No MCP risks detected')
    expect(markdown).toContain('Direct secret')
  })
})
