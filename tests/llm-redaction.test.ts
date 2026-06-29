import { afterEach, describe, expect, it, vi } from 'vitest'
import { synthesizeAgentReadinessNotes } from '../src/llm/synthesis.js'
import { redactSecrets, findSecretAssignments, isLikelySecretValue } from '../src/utils/redaction.js'
import type { AuditReport } from '../src/types.js'

const report: AuditReport = {
  tool: 'opscanon',
  version: '0.1.0',
  generatedAt: '1970-01-01T00:00:00.000Z',
  repo: { name: 'repo', path: '/repo' },
  overallScore: 72,
  categories: {
    agentSetupDocs: { score: 80, weight: 0.25, findings: [] },
    machineInterfaces: { score: 70, weight: 0.25, findings: [] },
    repoContextQuality: { score: 75, weight: 0.2, findings: [] },
    evalReproducibility: { score: 60, weight: 0.15, findings: [] },
    mcpSecurityBoundaries: { score: 80, weight: 0.15, findings: [] }
  },
  topFixes: [
    {
      code: 'docs.missing-setup',
      title: 'Missing setup instructions',
      severity: 'medium',
      message: 'Add setup docs.',
      recommendation: 'Document exact install and first-run commands.'
    }
  ],
  signals: {
    repoName: 'repo',
    filesScanned: 1,
    languages: ['typescript'],
    manifests: ['package.json'],
    docsFiles: ['README.md'],
    hasReadme: true,
    hasAgentInstructions: false,
    hasSetupDocs: false,
    hasUsageDocs: true,
    hasAgentDocs: false,
    hasCi: false,
    ciFiles: [],
    testCommands: [],
    buildCommands: [],
    lintCommands: [],
    hasCli: false,
    cliEntrypoints: [],
    hasOpenApi: false,
    openApiFiles: [],
    hasApiDocs: false,
    hasMcpDependency: false,
    mcpConfigFiles: [],
    envExampleFiles: [],
    findings: []
  }
}

describe('optional LLM synthesis', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does nothing without OPENAI_API_KEY', async () => {
    await expect(synthesizeAgentReadinessNotes(report, {})).resolves.toBeUndefined()
  })

  it('extracts output_text from the Responses API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output_text: 'Fix setup docs.' }), { status: 200 })))

    await expect(synthesizeAgentReadinessNotes(report, { OPENAI_API_KEY: 'test-key' })).resolves.toBe('Fix setup docs.')
  })

  it('extracts nested response output and ignores failed responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ text: 'Nested summary.' }] }]
    }), { status: 200 })))

    await expect(synthesizeAgentReadinessNotes(report, { OPENAI_API_KEY: 'test-key' })).resolves.toBe('Nested summary.')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(synthesizeAgentReadinessNotes(report, { OPENAI_API_KEY: 'test-key' })).resolves.toBeUndefined()
  })
})

describe('secret redaction', () => {
  it('redacts common token patterns and finds likely assignments', () => {
    const content = 'OPENAI_API_KEY=fake-openai-token-value-123456\nTOKEN=placeholder\nSECRET=${SECRET}'

    expect(redactSecrets(content)).not.toContain('fake-openai-token-value-123456')
    expect(findSecretAssignments(content)).toHaveLength(1)
    expect(isLikelySecretValue('short')).toBe(false)
    expect(isLikelySecretValue('placeholder')).toBe(false)
    expect(isLikelySecretValue('${TOKEN}')).toBe(false)
    expect(isLikelySecretValue('a'.repeat(24))).toBe(true)
  })
})
