import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { askBrain } from '../src/brain/ask.js'
import { buildBrain } from '../src/brain/compiler.js'
import { connectBrainSource } from '../src/brain/connectors.js'
import { crawlBrainSources } from '../src/brain/crawler.js'
import { refreshBrainSources, writeBrainFreshnessReport } from '../src/brain/freshness.js'
import { initializeBrain, readBrainSources, writeBrainConnectorManifest, writeBrainCrawlManifest, writeBrainSources } from '../src/brain/io.js'
import { createBrainMcpHandlers, handleBrainMcpJsonRpcMessage } from '../src/brain/mcp-server.js'
import type { BrainCrawlScan, BrainFact, BrainSourceRecord } from '../src/brain/types.js'
import { buildActionBoundaryReport, extractWorkflows, renderActionBoundariesMarkdown, renderWorkflowSkill, slugify } from '../src/brain/workflows.js'
import { runCli } from '../src/cli.js'
import { makeTempDir, removeTempDir } from './helpers.js'

async function createOperatingDocs(root: string): Promise<string> {
  const docs = join(root, 'ops-docs')
  await mkdir(docs, { recursive: true })
  await writeFile(
    join(docs, 'playbook.md'),
    `# Customer Operations Playbook

## Refund Workflow

- Support agents gather customer order history and summarize refund evidence.
- Refund requests above $500 require founder approval.
- Agents must not change billing records without approval.

## Incident Response

- Engineers triage severity, notify customer support, and create an incident timeline.
- Production rollback requires incident commander approval.
`,
    'utf8'
  )
  return docs
}

describe('company brain workflows and freshness', () => {
  it('compiles broad operating procedures across departments without relying on refund-style examples', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-operating-model')
    try {
      const docs = join(tempDir, 'company-operating-docs')
      const brainDir = join(tempDir, 'company-brain')
      await mkdir(docs, { recursive: true })
      await writeFile(
        join(docs, 'company-operations.md'),
        `# Company Operating Manual

## Sales Qualification

- When a new inbound lead arrives, the SDR checks CRM fit, company size, budget, and timeline.
- SDR updates HubSpot with qualification notes and the recommended next step.
- Enterprise discount requests require VP Sales approval.
- Output: qualified opportunity or nurture reason.

## Hiring Interview Loop

- Recruiter opens role intake with the hiring manager.
- Interviewers submit scorecards in Greenhouse within 24 hours.
- Offer compensation changes require People lead approval.
- Output: hire/no-hire recommendation with evidence.

## Security Review

- Engineer opens security review before adding a new vendor.
- Security owner checks data classification, access scope, and vendor subprocessors.
- Do not share production credentials with vendors.
- Output: approved vendor, rejected vendor, or open risk questions.

## Monthly Finance Close

- Finance lead reconciles invoices in QuickBooks.
- Controller approves adjustments before books are closed.
- Output: close checklist and variance report.
`,
        'utf8'
      )

      await crawlBrainSources(docs, brainDir, {
        sourceType: 'docs',
        consent: 'company-owner-approved'
      })
      const result = await buildBrain(brainDir)

      expect(result.workflowCount).toBeGreaterThanOrEqual(4)

      const operatingModel = await readFile(join(brainDir, 'operating-model.md'), 'utf8')
      expect(operatingModel).toContain('Sales Qualification')
      expect(operatingModel).toContain('Hiring Interview Loop')
      expect(operatingModel).toContain('Security Review')
      expect(operatingModel).toContain('Monthly Finance Close')
      expect(operatingModel).toContain('HubSpot')
      expect(operatingModel).toContain('Greenhouse')
      expect(operatingModel).toContain('QuickBooks')

      const operatingModelJson = JSON.parse(await readFile(join(brainDir, 'operating-model.json'), 'utf8')) as {
        procedures: Array<{
          slug: string
          owners: string[]
          systems: string[]
          decisionRules: string[]
          outputs: string[]
          riskLevel: string
        }>
      }
      expect(operatingModelJson.procedures.map((procedure) => procedure.slug)).toEqual(expect.arrayContaining([
        'sales-qualification',
        'hiring-interview-loop',
        'security-review',
        'monthly-finance-close'
      ]))
      expect(operatingModelJson.procedures.find((procedure) => procedure.slug === 'sales-qualification')).toMatchObject({
        owners: expect.arrayContaining(['SDR']),
        systems: expect.arrayContaining(['HubSpot']),
        decisionRules: expect.arrayContaining(['Enterprise discount requests require VP Sales approval.'])
      })
      expect(operatingModelJson.procedures.find((procedure) => procedure.slug === 'security-review')).toMatchObject({
        systems: expect.arrayContaining(['vendor']),
        riskLevel: 'human-owned'
      })

      const salesSkill = await readFile(join(brainDir, 'skills', 'sales-qualification.md'), 'utf8')
      expect(salesSkill).toContain('name: sales-qualification')
      expect(salesSkill).toContain('Systems Touched')
      expect(salesSkill).toContain('HubSpot')
      expect(salesSkill).toContain('VP Sales approval')

      const hiringSkill = await readFile(join(brainDir, 'skills', 'hiring-interview-loop.md'), 'utf8')
      expect(hiringSkill).toContain('People lead approval')
      expect(hiringSkill).toContain('Greenhouse')

      const boundaries = await readFile(join(brainDir, 'action-boundaries.md'), 'utf8')
      expect(boundaries).toContain('Enterprise discount requests require VP Sales approval.')
      expect(boundaries).toContain('Offer compensation changes require People lead approval.')
      expect(boundaries).toContain('Do not share production credentials with vendors.')

      const handlers = createBrainMcpHandlers(brainDir)
      const operating = await handlers.getOperatingModel()
      expect(operating.text).toContain('Operating Model')
      expect(operating.text).toContain('Sales Qualification')

      const answer = await askBrain(brainDir, 'Which systems are used for sales qualification and hiring?')
      expect(answer.answer).toContain('HubSpot')
      expect(answer.answer).toContain('Greenhouse')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('builds workflow-specific executable skills and action boundaries from source evidence', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-workflows')
    try {
      const docs = await createOperatingDocs(tempDir)
      const brainDir = join(tempDir, 'company-brain')

      await crawlBrainSources(docs, brainDir, {
        sourceType: 'docs',
        consent: 'ops-owner-approved'
      })
      const result = await buildBrain(brainDir)

      expect(result.workflowCount).toBeGreaterThanOrEqual(2)

      const workflows = JSON.parse(await readFile(join(brainDir, 'workflows.json'), 'utf8')) as { workflows: Array<{ slug: string; title: string }> }
      expect(workflows.workflows.map((workflow) => workflow.slug)).toEqual(expect.arrayContaining(['refund-handling', 'incident-response']))

      const refundWorkflow = await readFile(join(brainDir, 'workflows', 'refund-handling.md'), 'utf8')
      expect(refundWorkflow).toContain('Refund Handling')
      expect(refundWorkflow).toContain('founder approval')
      expect(refundWorkflow).toContain('Agent Procedure')

      const refundSkill = await readFile(join(brainDir, 'skills', 'refund-handling.md'), 'utf8')
      expect(refundSkill).toContain('name: refund-handling')
      expect(refundSkill).toContain('Requires Human Approval')
      expect(refundSkill).toContain('must not change billing records')

      const actionBoundaries = await readFile(join(brainDir, 'action-boundaries.md'), 'utf8')
      expect(actionBoundaries).toContain('changing customer records')
      expect(actionBoundaries).toContain('Production rollback')

      const handlers = createBrainMcpHandlers(brainDir)
      const workflow = await handlers.getWorkflow({ name: 'refund-handling' })
      expect(workflow.text).toContain('Refund Handling')

      const boundaries = await handleBrainMcpJsonRpcMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_action_boundaries', arguments: {} }
      }, handlers)
      expect(JSON.stringify(boundaries?.result)).toContain('Action Boundaries')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('refreshes prior approved crawls so stale source content is replaced and freshness is reported', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-refresh')
    try {
      const docs = await createOperatingDocs(tempDir)
      const brainDir = join(tempDir, 'company-brain')
      const playbookPath = join(docs, 'playbook.md')

      await crawlBrainSources(docs, brainDir, {
        sourceType: 'docs',
        consent: 'ops-owner-approved'
      })
      await buildBrain(brainDir)
      await writeFile(
        playbookPath,
        `# Customer Operations Playbook

## Refund Workflow

- Support agents gather customer order history and summarize refund evidence.
- Refund requests above $750 require founder approval.
- Agents must not change billing records without approval.
`,
        'utf8'
      )

      const refresh = await refreshBrainSources(brainDir, { buildAfter: true })
      expect(refresh.refreshedScopes).toBe(1)
      expect(refresh.failedScopes).toBe(0)

      const sourcesJsonl = await readFile(join(brainDir, 'sources.jsonl'), 'utf8')
      expect(sourcesJsonl).toContain('$750')
      expect(sourcesJsonl).not.toContain('$500')

      const answer = await askBrain(brainDir, 'What refund amount requires approval?')
      expect(answer.answer).toContain('$750')

      const freshness = await writeBrainFreshnessReport(brainDir, { maxAgeDays: 30 })
      expect(freshness.status).toBe('fresh')
      await expect(readFile(join(brainDir, 'freshness-report.md'), 'utf8')).resolves.toContain('Freshness Report')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('registers export-folder connectors and refreshes connected source folders without live SaaS auth', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-connectors')
    try {
      const exportDir = join(tempDir, 'notion-export')
      const brainDir = join(tempDir, 'company-brain')
      await mkdir(exportDir, { recursive: true })
      await writeFile(
        join(exportDir, 'pricing.md'),
        `# Pricing Exceptions

Pricing exceptions above $1000 require founder approval.
Agents may summarize the customer case before asking for approval.
`,
        'utf8'
      )

      const connected = await connectBrainSource('notion', exportDir, brainDir, {
        consent: 'client-approved-export'
      })
      expect(connected.connector.provider).toBe('notion')
      expect(connected.crawl.sourcesAdded).toBe(1)

      const connectors = JSON.parse(await readFile(join(brainDir, 'connectors.json'), 'utf8')) as { connectors: Array<{ provider: string; mode: string; sourceAdapter: string }> }
      expect(connectors.connectors).toEqual([
        expect.objectContaining({ provider: 'notion', mode: 'export-folder', sourceAdapter: 'notion-export' })
      ])

      const sources = await readBrainSources(brainDir)
      expect(sources[0]).toMatchObject({
        sourceType: 'notion',
        metadata: { sourceAdapter: 'notion-export' }
      })

      await writeFile(
        join(exportDir, 'pricing.md'),
        `# Pricing Exceptions

Pricing exceptions above $2000 require founder approval.
Agents may summarize the customer case before asking for approval.
`,
        'utf8'
      )

      const stdout: string[] = []
      await expect(runCli(['brain', 'refresh', '--brain', brainDir, '--build'], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      expect(stdout.join('')).toContain('Refreshed 1 company-brain source scope')

      const refreshedSources = await readFile(join(brainDir, 'sources.jsonl'), 'utf8')
      expect(refreshedSources).toContain('$2000')
      expect(refreshedSources).not.toContain('$1000')

      await expect(runCli(['brain', 'freshness', '--brain', brainDir, '--max-age-days', '30'], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      expect(stdout.join('')).toContain('freshness-report.md')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('handles connector validation, refresh failures, stale sources, and MCP freshness fallback', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-edge-cases')
    try {
      const brainDir = join(tempDir, 'company-brain')
      const exportDir = join(tempDir, 'slack-export')
      await mkdir(exportDir, { recursive: true })
      await writeFile(
        join(exportDir, 'incident.md'),
        `# Incident Response

Engineers triage severity and create an incident timeline.
Production rollback requires incident commander approval.
`,
        'utf8'
      )

      await expect(connectBrainSource('slack', exportDir, brainDir)).rejects.toThrow('requires --consent')

      const stderr: string[] = []
      await expect(runCli(['brain', 'connect', 'slack'], {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
        env: {}
      })).resolves.toBe(1)
      expect(stderr.join('')).toContain('requires a provider and an export/sync folder path')

      const connected = await connectBrainSource('slack', exportDir, brainDir, {
        consent: 'support-lead-approved',
        mode: 'sync-folder',
        sourceAdapter: 'slack-sync',
        maxFiles: 10,
        maxBytesPerFile: 1000
      })
      expect(connected.connector.mode).toBe('sync-folder')
      await rm(exportDir, { recursive: true, force: true })

      const refresh = await refreshBrainSources(brainDir, { buildAfter: true })
      expect(refresh.refreshedScopes).toBe(0)
      expect(refresh.failedScopes).toBe(1)
      expect(refresh.built).toBe(false)

      const emptyBrainDir = join(tempDir, 'empty-brain')
      await initializeBrain(emptyBrainDir)
      const missing = await writeBrainFreshnessReport(emptyBrainDir)
      expect(missing.status).toBe('missing')

      const handlers = createBrainMcpHandlers(emptyBrainDir)
      const fallback = await handlers.getFreshness()
      expect(fallback.text).toContain('Freshness Report')

      const oldBrainDir = join(tempDir, 'old-brain')
      await initializeBrain(oldBrainDir)
      const oldTimestamp = '2000-01-01T00:00:00.000Z'
      const oldSource: BrainSourceRecord = {
        id: 'src_old',
        sourceType: 'docs',
        title: 'Old Policy',
        path: join(tempDir, 'old.md'),
        content: 'Refund requests require approval.',
        contentHash: 'old',
        ingestedAt: oldTimestamp,
        redacted: false,
        metadata: {
          relativePath: 'old.md',
          bytes: 33,
          lastModified: oldTimestamp,
          sourceAdapter: 'manual-test'
        }
      }
      await writeBrainSources(oldBrainDir, [oldSource])
      const stale = await writeBrainFreshnessReport(oldBrainDir, { maxAgeDays: 1 })
      expect(stale.status).toBe('stale')
      expect(stale.items[0]?.recommendation).toContain('Run brain refresh')

      const scanBrainDir = join(tempDir, 'scan-brain')
      await initializeBrain(scanBrainDir)
      const futureScan: BrainCrawlScan = {
        scanId: 'crawl_future',
        rootPath: join(tempDir, 'future-export'),
        sourceType: 'docs',
        sourceAdapter: 'future-export',
        consent: 'future-approved',
        mode: 'local-filesystem',
        allCompanyFiles: false,
        dryRun: false,
        scannedAt: '2999-01-01T00:00:00.000Z',
        maxFiles: 10,
        maxBytesPerFile: 1000,
        filesDiscovered: 0,
        filesEligible: 0,
        filesSkipped: 0,
        sourcesAdded: 0,
        sourcesSkipped: 0,
        sourceCount: 0,
        redactedSources: 0,
        skippedByReason: {},
        skippedSamples: []
      }
      await writeBrainCrawlManifest(scanBrainDir, { version: 1, scans: [futureScan] })
      const scanFreshness = await writeBrainFreshnessReport(scanBrainDir, { maxAgeDays: 1 })
      expect(scanFreshness.status).toBe('fresh')
      expect(scanFreshness.items[0]?.ageDays).toBe(0)

      const connectorBrainDir = join(tempDir, 'missing-connector-brain')
      await initializeBrain(connectorBrainDir)
      await writeBrainConnectorManifest(connectorBrainDir, {
        version: 1,
        connectors: [{
          id: 'connector_missing',
          provider: 'jira',
          mode: 'export-folder',
          path: join(tempDir, 'missing-jira-export'),
          sourceAdapter: 'jira-export',
          consent: 'jira-owner-approved',
          enabled: true,
          registeredAt: timestampForTest()
        }]
      })
      const connectorFreshness = await writeBrainFreshnessReport(connectorBrainDir)
      expect(connectorFreshness.status).toBe('missing')
      expect(connectorFreshness.items[0]?.recommendation).toContain('Connect or crawl')

      const cliExportDir = join(tempDir, 'drive-export')
      const cliBrainDir = join(tempDir, 'cli-brain')
      const cliOutput: string[] = []
      await mkdir(cliExportDir, { recursive: true })
      await writeFile(join(cliExportDir, 'customer-records.md'), '# Customer Record Process\n\nAgents may read customer records.\nChanging customer data requires manager approval.\n', 'utf8')
      await expect(runCli(['brain', 'connect', 'drive', cliExportDir, '--mode', 'sync-folder', '--adapter', 'drive-sync', '--consent', 'drive-owner-approved', '--out', cliBrainDir], {
        stdout: (text) => cliOutput.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      expect(cliOutput.join('')).toContain('drive sync-folder')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('extracts workflow variants and fallback skill surfaces from deterministic source records', () => {
    const timestamp = new Date().toISOString()
    const source = makeSource('src_ops', `# Operations Handbook

## Pricing Exception Process

Pricing exceptions above 20 percent require founder approval.

## Customer Record Process

Agents may read customer records and summarize evidence.
Changing customer data requires manager approval.

## Billing Runbook

Billing changes require finance approval.

## Escalation Process

Support agents escalate enterprise customers to the account lead.

## Archive Workflow

tiny
`, timestamp)
    const secondSource = makeSource('src_refund', `# Refund Desk

## Refund Process

Support agents gather customer order history.
Refund requests above 300 dollars require founder approval.
`, timestamp)
    const facts: BrainFact[] = [
      {
        id: 'fact_policy',
        claim: 'Agents require permission before posting externally.',
        category: 'policy',
        sourceIds: [source.id],
        subjects: ['Agents'],
        confidence: 0.8,
        status: 'active',
        lastSeen: timestamp
      },
      {
        id: 'fact_workflow',
        claim: 'Weekly planning process gathers customer feedback and creates priorities.',
        category: 'workflow',
        sourceIds: [source.id],
        subjects: ['Weekly Planning'],
        confidence: 0.8,
        status: 'active',
        lastSeen: timestamp
      }
    ]

    const workflows = extractWorkflows([source, secondSource], facts)
    expect(workflows.map((workflow) => workflow.slug)).toEqual(expect.arrayContaining([
      'pricing-exception-handling',
      'customer-record-handling',
      'billing-change-handling',
      'escalation-handling',
      'refund-handling',
      'weekly-planning-gathers-customer-feedback-and-creates-priorities'
    ]))
    expect(workflows.find((workflow) => workflow.slug === 'escalation-handling')?.riskLevel).toBe('read-only')

    const boundaryReport = buildActionBoundaryReport(workflows, facts)
    const renderedBoundaries = renderActionBoundariesMarkdown(boundaryReport, [source, secondSource])
    expect(renderedBoundaries).toContain('posting externally')

    const genericSkill = renderWorkflowSkill(workflows.find((workflow) => workflow.slug === 'escalation-handling')!, [source, secondSource])
    expect(genericSkill).toContain('Allowed Without Approval')
    expect(slugify('!!!')).toBe('workflow')
  })
})

function makeSource(id: string, content: string, timestamp: string): BrainSourceRecord {
  return {
    id,
    sourceType: 'docs',
    title: 'Operations Handbook',
    path: `${id}.md`,
    content,
    contentHash: id,
    ingestedAt: timestamp,
    redacted: false,
    metadata: {
      relativePath: `${id}.md`,
      bytes: Buffer.byteLength(content, 'utf8'),
      lastModified: timestamp,
      sourceAdapter: 'unit-test'
    }
  }
}

function timestampForTest(): string {
  return new Date().toISOString()
}
