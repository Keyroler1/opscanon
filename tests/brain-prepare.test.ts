import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareBrainKnowledge } from '../src/brain/prepare.js'
import { runCli } from '../src/cli.js'
import { listFiles, makeTempDir, removeTempDir } from './helpers.js'

async function createMessyKnowledgeFolder(root: string): Promise<string> {
  const rawDir = join(root, 'messy-company-export')
  await mkdir(rawDir, { recursive: true })
  const sales = `Sales Qualification

When a new inbound lead arrives, the SDR checks CRM fit, company size, budget, and timeline.
SDR updates HubSpot with qualification notes and the recommended next step.
Enterprise discount requests above $1000 require VP Sales approval.
Output: qualified opportunity or nurture reason.
`
  await writeFile(join(rawDir, 'sales-notes.txt'), sales, 'utf8')
  await writeFile(join(rawDir, 'sales-copy.md'), sales, 'utf8')
  await writeFile(
    join(rawDir, 'security-vendor-review.md'),
    `# Security Vendor Review

Engineer opens security review before adding a new vendor.
Security owner checks data classification, access scope, and vendor subprocessors.
Do not share production credentials with vendors.
OPENAI_API_KEY=sk-fake-prepare-secret-1234567890
Output: approved vendor, rejected vendor, or open risk questions.
`,
    'utf8'
  )
  await writeFile(
    join(rawDir, 'refund-old.md'),
    `# Refund Handling

Refund requests above $500 require founder approval.
Support lead updates Stripe after approval.
Output: approved refund or rejected refund.
`,
    'utf8'
  )
  await writeFile(
    join(rawDir, 'refund-current.md'),
    `# Refund Handling

Refund requests above $750 require founder approval.
Support lead updates Stripe after approval.
Output: approved refund or rejected refund.
`,
    'utf8'
  )
  await writeFile(join(rawDir, 'empty.txt'), '', 'utf8')
  await writeFile(join(rawDir, 'random-note.txt'), 'misc misc misc misc misc\n', 'utf8')
  await writeFile(join(rawDir, 'scan.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]))

  const oldDate = new Date('2000-01-01T00:00:00.000Z')
  await utimes(join(rawDir, 'refund-old.md'), oldDate, oldDate)
  return rawDir
}

describe('AI-ready knowledge preparation', () => {
  it('turns messy customer data into an AI-ready pack with quality gates and review queues', async () => {
    const tempDir = await makeTempDir('ai-ready-prepare')
    try {
      const rawDir = await createMessyKnowledgeFolder(tempDir)
      const packDir = join(tempDir, 'ai-ready-pack')

      const result = await prepareBrainKnowledge(rawDir, packDir, {
        sourceType: 'docs',
        maxAgeDays: 365,
        minQualityScore: 70
      })

      expect(result.totalFiles).toBe(8)
      expect(result.cleanedDocuments).toBeGreaterThanOrEqual(3)
      expect(result.reviewItems).toBeGreaterThanOrEqual(4)
      expect(result.duplicateItems).toBe(1)

      const packFiles = await listFiles(packDir)
      expect(packFiles).toEqual(expect.arrayContaining([
        'candidate-operating-knowledge.json',
        'document-quality-report.md',
        'duplicate-report.md',
        'human-review-queue.md',
        'noise-staleness-report.md',
        'source-inventory.json'
      ]))

      const inventory = JSON.parse(await readFile(join(packDir, 'source-inventory.json'), 'utf8')) as {
        documents: Array<{ relativePath: string; status: string; classifications: string[]; duplicateOf?: string; qualityScore: number }>
      }
      expect(inventory.documents.find((document) => document.relativePath === 'sales-copy.md')).toMatchObject({
        status: 'exclude',
        classifications: expect.arrayContaining(['duplicate'])
      })
      expect(inventory.documents.find((document) => document.relativePath === 'refund-old.md')).toMatchObject({
        status: 'review',
        classifications: expect.arrayContaining(['stale'])
      })
      expect(inventory.documents.find((document) => document.relativePath === 'scan.pdf')).toMatchObject({
        status: 'review',
        classifications: expect.arrayContaining(['unreadable'])
      })
      expect(inventory.documents.find((document) => document.relativePath === 'random-note.txt')?.qualityScore).toBeLessThan(70)

      const cleanedFiles = await listFiles(join(packDir, 'cleaned-sources'))
      expect(cleanedFiles).toEqual(expect.arrayContaining([
        'refund-current.md',
        'sales-notes.md',
        'security-vendor-review.md'
      ]))
      expect(cleanedFiles).not.toContain('sales-copy.md')
      expect(cleanedFiles).not.toContain('refund-old.md')

      const cleanedSecurity = await readFile(join(packDir, 'cleaned-sources', 'security-vendor-review.md'), 'utf8')
      expect(cleanedSecurity).toContain('[REDACTED]')
      expect(cleanedSecurity).not.toContain('sk-fake-prepare-secret')
      expect(cleanedSecurity).toContain('original_path: security-vendor-review.md')

      const candidates = JSON.parse(await readFile(join(packDir, 'candidate-operating-knowledge.json'), 'utf8')) as {
        procedures: Array<{ slug: string; systems: string[]; requiresApproval: string[] }>
      }
      expect(candidates.procedures.map((procedure) => procedure.slug)).toEqual(expect.arrayContaining([
        'sales-qualification',
        'security-vendor-review',
        'refund-handling'
      ]))
      expect(candidates.procedures.find((procedure) => procedure.slug === 'sales-qualification')).toMatchObject({
        systems: expect.arrayContaining(['HubSpot']),
        requiresApproval: expect.arrayContaining(['Enterprise discount requests above $1000 require VP Sales approval.'])
      })

      const reviewQueue = await readFile(join(packDir, 'human-review-queue.md'), 'utf8')
      expect(reviewQueue).toContain('scan.pdf')
      expect(reviewQueue).toContain('OCR/manual review')
      expect(reviewQueue).toContain('refund-old.md')
      expect(reviewQueue).toContain('Conflicting approval thresholds')

      const duplicateReport = await readFile(join(packDir, 'duplicate-report.md'), 'utf8')
      expect(duplicateReport).toContain('sales-copy.md')
      expect(duplicateReport).toContain('sales-notes.txt')

      const noiseReport = await readFile(join(packDir, 'noise-staleness-report.md'), 'utf8')
      expect(noiseReport).toContain('random-note.txt')
      expect(noiseReport).toContain('empty.txt')
      expect(noiseReport).toContain('refund-old.md')

      const allPackText = (await Promise.all(packFiles
        .filter((file) => !file.endsWith('.json'))
        .map((file) => readFile(join(packDir, file), 'utf8').catch(() => '')))).join('\n')
      expect(allPackText).not.toContain('sk-fake-prepare-secret')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('lets the CLI prepare a pack and build the brain only from cleaned high-confidence sources', async () => {
    const tempDir = await makeTempDir('ai-ready-prepare-cli')
    try {
      const rawDir = await createMessyKnowledgeFolder(tempDir)
      const packDir = join(tempDir, 'ai-ready-pack')
      const brainDir = join(tempDir, 'company-brain')
      const output: string[] = []

      await expect(runCli(['brain', 'prepare', rawDir, '--source', 'docs', '--out', packDir, '--max-age-days', '365', '--min-score', '70'], {
        stdout: (text) => output.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      await expect(runCli(['brain', 'build', '--prepared', packDir, '--source', 'docs', '--out', brainDir], {
        stdout: (text) => output.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      expect(output.join('')).toContain('Prepared AI-ready knowledge pack')
      expect(output.join('')).toContain('cleaned')
      await expect(stat(join(brainDir, 'operating-model.md'))).resolves.toBeTruthy()
      await expect(readFile(join(brainDir, 'skills', 'sales-qualification.md'), 'utf8')).resolves.toContain('HubSpot')
      await expect(stat(join(brainDir, 'skills', 'random-note.md'))).rejects.toThrow()
      const skillFiles = await listFiles(join(brainDir, 'skills'))
      expect(skillFiles.some((file) => file.startsWith('original-path') || file.startsWith('detected-owner') || file.startsWith('output-'))).toBe(false)

      const sourcesJsonl = await readFile(join(brainDir, 'sources.jsonl'), 'utf8')
      expect(sourcesJsonl).toContain('refund-current.md')
      expect(sourcesJsonl).not.toContain('refund-old.md')
      expect(sourcesJsonl).not.toContain('misc misc misc')
      expect(sourcesJsonl).not.toContain('sk-fake-prepare-secret')
    } finally {
      await removeTempDir(tempDir)
    }
  })
})
