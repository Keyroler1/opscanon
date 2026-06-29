import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { listFiles, makeTempDir, removeTempDir } from './helpers.js'

async function createClientKnowledgeDump(root: string): Promise<{ rawDir: string; ocrDir: string }> {
  const rawDir = join(root, 'client-export')
  const ocrDir = join(root, 'ocr-output')
  await mkdir(rawDir, { recursive: true })
  await mkdir(ocrDir, { recursive: true })

  await writeFile(join(rawDir, 'pricing-sales.md'), `# Discount Approval Process

Owner: Sales lead
When an enterprise discount request arrives, the SDR checks CRM fit and budget.
Discount requests above $1000 require VP Sales approval.
SDR updates HubSpot with approval notes.
Output: approved discount or rejected discount reason.
`, 'utf8')

  await writeFile(join(rawDir, 'pricing-finance.md'), `# Discount Approval Policy

Owner: Finance lead
Discount requests above $1000 require CFO approval.
Finance lead reviews margin impact in QuickBooks.
Output: approved discount or finance rejection reason.
`, 'utf8')

  await writeFile(join(rawDir, 'customer-records-allow.md'), `# Customer Record Handling

Owner: Support lead
Agents may update customer records after manager approval.
Support lead updates Zendesk and CRM with the change reason.
Output: updated customer record and audit note.
`, 'utf8')

  await writeFile(join(rawDir, 'customer-records-deny.md'), `# Customer Data Policy

Owner: Security owner
Agents must not update customer records.
Security owner reviews customer data access exceptions.
`, 'utf8')

  await writeFile(join(rawDir, 'scanned-runbook.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]))
  await writeFile(join(ocrDir, 'scanned-runbook.pdf.txt'), `# Vendor Review Runbook

Owner: Security owner
Engineer opens security review before adding a new vendor.
Security owner checks data classification and vendor subprocessors.
Output: approved vendor, rejected vendor, or open risk questions.
`, 'utf8')

  const oldDate = new Date('2000-01-01T00:00:00.000Z')
  await writeFile(join(rawDir, 'old-incident-runbook.md'), `# Incident Response

Owner: Engineer
When a Sev1 incident opens, engineer opens Linear and Slack.
Production rollback requires incident commander approval.
Output: incident timeline and rollback decision.
`, 'utf8')
  await utimes(join(rawDir, 'old-incident-runbook.md'), oldDate, oldDate)

  return { rawDir, ocrDir }
}

describe('company brain product loop', () => {
  it('prepares a reviewable pack with manifest, dashboard, OCR intake, and richer conflict findings', async () => {
    const tempDir = await makeTempDir('brain-product-loop')
    try {
      const { rawDir, ocrDir } = await createClientKnowledgeDump(tempDir)
      const packDir = join(tempDir, 'ai-ready-pack')
      const output: string[] = []

      await expect(runCli(['brain', 'prepare', rawDir, '--source', 'docs', '--out', packDir, '--ocr-text', ocrDir, '--dashboard', '--max-age-days', '365'], {
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
        env: {}
      })).resolves.toBe(0)

      const files = await listFiles(packDir)
      expect(files).toEqual(expect.arrayContaining([
        'manifest.json',
        'review-dashboard.html',
        'ocr-review.md',
        'review-decisions.json',
        'cleaned-sources/scanned-runbook.md'
      ]))

      const manifest = JSON.parse(await readFile(join(packDir, 'manifest.json'), 'utf8')) as {
        version: number
        safeToBuild: boolean
        packQualityScore: number
        counts: { totalFiles: number; compileReady: number; review: number; conflicts: number; unreadable: number }
        nextCommands: string[]
      }
      expect(manifest.version).toBe(1)
      expect(manifest.counts.totalFiles).toBe(6)
      expect(manifest.counts.compileReady).toBeGreaterThanOrEqual(1)
      expect(manifest.counts.conflicts).toBeGreaterThanOrEqual(2)
      expect(manifest.counts.unreadable).toBe(0)
      expect(manifest.packQualityScore).toBeGreaterThan(50)
      expect(manifest.nextCommands.join('\n')).toContain('opscanon review')

      const inventory = JSON.parse(await readFile(join(packDir, 'source-inventory.json'), 'utf8')) as {
        documents: Array<{ relativePath: string; status: string; classifications: string[]; reasons: string[] }>
      }
      expect(inventory.documents.find((document) => document.relativePath === 'pricing-sales.md')).toMatchObject({
        status: 'review',
        classifications: expect.arrayContaining(['conflict'])
      })
      expect(inventory.documents.find((document) => document.relativePath === 'customer-records-allow.md')?.reasons.join(' ')).toContain('Conflicting permission')
      expect(inventory.documents.find((document) => document.relativePath === 'scanned-runbook.pdf')).toMatchObject({
        status: 'compile',
        classifications: expect.arrayContaining(['ocr-converted'])
      })

      const dashboard = await readFile(join(packDir, 'review-dashboard.html'), 'utf8')
      expect(dashboard).toContain('AI-Ready Knowledge Review')
      expect(dashboard).toContain('pricing-sales.md')
      expect(dashboard).not.toContain('<script>')

      const ocrReview = await readFile(join(packDir, 'ocr-review.md'), 'utf8')
      expect(ocrReview).toContain('scanned-runbook.pdf')
      expect(ocrReview).toContain('OCR text supplied')

      const reviewTemplate = JSON.parse(await readFile(join(packDir, 'review-decisions.json'), 'utf8')) as {
        decisions: Array<{ path: string; decision: string; allowedDecisions: string[] }>
      }
      expect(reviewTemplate.decisions.find((decision) => decision.path === 'old-incident-runbook.md')).toMatchObject({
        decision: 'needs-review',
        allowedDecisions: expect.arrayContaining(['approve-current', 'reject'])
      })
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('supports human approval, approved-pack builds, brain quality scoring, evals, and executable skill contracts', async () => {
    const tempDir = await makeTempDir('brain-review-approve')
    try {
      const { rawDir, ocrDir } = await createClientKnowledgeDump(tempDir)
      const packDir = join(tempDir, 'ai-ready-pack')
      const approvedPackDir = join(tempDir, 'approved-pack')
      const brainDir = join(tempDir, 'company-brain')
      const output: string[] = []

      await expect(runCli(['brain', 'prepare', rawDir, '--source', 'docs', '--out', packDir, '--ocr-text', ocrDir, '--max-age-days', '365'], {
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
        env: {}
      })).resolves.toBe(0)

      await expect(runCli(['brain', 'review', packDir], {
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
        env: {}
      })).resolves.toBe(0)

      const decisionsPath = join(packDir, 'review-decisions.json')
      const decisions = JSON.parse(await readFile(decisionsPath, 'utf8')) as {
        decisions: Array<{ path: string; decision: string; reviewer: string; notes: string }>
      }
      await writeFile(decisionsPath, `${JSON.stringify({
        ...decisions,
        decisions: decisions.decisions.map((decision) => decision.path === 'old-incident-runbook.md'
          ? { ...decision, decision: 'approve-current', reviewer: 'ops-lead', notes: 'Current incident process confirmed for this client.' }
          : decision)
      }, null, 2)}\n`, 'utf8')

      await expect(runCli(['brain', 'approve', packDir, '--out', approvedPackDir, '--decisions', decisionsPath], {
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
        env: {}
      })).resolves.toBe(0)

      await expect(runCli(['brain', 'build', '--prepared', approvedPackDir, '--source', 'docs', '--out', brainDir], {
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
        env: {}
      })).resolves.toBe(0)

      await expect(runCli(['brain', 'score', '--brain', brainDir], {
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
        env: {}
      })).resolves.toBe(0)

      await expect(runCli(['brain', 'eval', '--brain', brainDir], {
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
        env: {}
      })).resolves.toBe(0)

      const approvedFiles = await listFiles(join(approvedPackDir, 'cleaned-sources'))
      expect(approvedFiles).toEqual(expect.arrayContaining(['old-incident-runbook.md', 'scanned-runbook.md']))

      const quality = JSON.parse(await readFile(join(brainDir, 'brain-quality-report.json'), 'utf8')) as {
        score: number
        checks: Array<{ id: string; status: string }>
      }
      expect(quality.score).toBeGreaterThanOrEqual(60)
      expect(quality.checks.find((check) => check.id === 'workflow-owner-coverage')?.status).toBe('pass')

      const evalReport = JSON.parse(await readFile(join(brainDir, 'brain-eval-report.json'), 'utf8')) as {
        status: string
        checks: Array<{ id: string; status: string }>
      }
      expect(evalReport.status).toBe('pass')
      expect(evalReport.checks.find((check) => check.id === 'secret-redaction')?.status).toBe('pass')

      const incidentSkill = await readFile(join(brainDir, 'skills', 'incident-response.md'), 'utf8')
      expect(incidentSkill).toContain('## Required Inputs')
      expect(incidentSkill).toContain('## Stop Conditions')
      expect(incidentSkill).toContain('## Output Format')
      expect(incidentSkill).toContain('explicit human approval')

      const buildOutput = output.join('\n')
      expect(buildOutput).toContain('Company Brain Score')
      await expect(stat(join(brainDir, 'brain-quality-report.md'))).resolves.toBeTruthy()
      await expect(stat(join(brainDir, 'brain-eval-report.md'))).resolves.toBeTruthy()
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('applies approve-with-corrections and reject decisions without leaking corrected secrets', async () => {
    const tempDir = await makeTempDir('brain-review-branches')
    try {
      const rawDir = join(tempDir, 'raw')
      const packDir = join(tempDir, 'pack')
      const approvedPackDir = join(tempDir, 'approved')
      const correctionsDir = join(tempDir, 'corrections')
      await mkdir(rawDir, { recursive: true })
      await mkdir(correctionsDir, { recursive: true })
      await writeFile(join(rawDir, 'old-policy.md'), `# Vendor Approval

Owner: Security owner
Engineer opens security review before adding a vendor.
Vendor approval requires Security owner approval.
Output: approved vendor.
`, 'utf8')
      await writeFile(join(rawDir, 'reject-me.md'), `# Random Export

misc misc misc misc misc
`, 'utf8')
      const oldDate = new Date('2000-01-01T00:00:00.000Z')
      await utimes(join(rawDir, 'old-policy.md'), oldDate, oldDate)
      await writeFile(join(correctionsDir, 'vendor-current.md'), `# Vendor Approval

Owner: Security owner
Engineer opens security review before adding a vendor.
Vendor approval requires Security owner approval.
OPENAI_API_KEY=sk-fake-correction-secret-1234567890
Output: approved vendor.
`, 'utf8')

      await expect(runCli(['brain', 'prepare', rawDir, '--out', packDir, '--max-age-days', '365'], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      await expect(runCli(['brain', 'review', packDir], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      const decisionsPath = join(packDir, 'review-decisions.json')
      const decisions = JSON.parse(await readFile(decisionsPath, 'utf8')) as {
        decisions: Array<{ path: string; decision: string; reviewer: string; notes: string; correctedContentPath?: string }>
      }
      await writeFile(decisionsPath, `${JSON.stringify({
        ...decisions,
        decisions: decisions.decisions.map((decision) => {
          if (decision.path === 'old-policy.md') {
            return {
              ...decision,
              decision: 'approve-with-corrections',
              reviewer: 'security-owner',
              notes: 'Supplied current vendor approval text.',
              correctedContentPath: join(correctionsDir, 'vendor-current.md')
            }
          }
          return { ...decision, decision: 'reject', reviewer: 'ops', notes: 'Noise export.' }
        })
      }, null, 2)}\n`, 'utf8')

      await expect(runCli(['brain', 'approve', packDir, '--out', approvedPackDir, '--decisions', decisionsPath], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      const approvedText = await readFile(join(approvedPackDir, 'cleaned-sources', 'old-policy.md'), 'utf8')
      const summary = await readFile(join(approvedPackDir, 'approval-summary.md'), 'utf8')
      expect(approvedText).toContain('[REDACTED]')
      expect(approvedText).not.toContain('sk-fake-correction-secret')
      expect(summary).toContain('Documents approved into cleaned-sources: 1')
      expect(summary).toContain('Documents rejected: 1')
    } finally {
      await removeTempDir(tempDir)
    }
  })
})
