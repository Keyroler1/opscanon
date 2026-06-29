import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { copyFixture, listFiles, makeTempDir, removeTempDir } from './helpers.js'

async function createOpsDocs(root: string): Promise<string> {
  const rawDir = join(root, 'raw-company-export')
  await mkdir(rawDir, { recursive: true })
  await writeFile(
    join(rawDir, 'support-refunds.md'),
    `# Refund Handling

Owner: Support lead
When a customer requests a refund, Support agent checks Zendesk ticket history, Stripe charge status, and account notes.
Support agent summarizes evidence and prepares the recommended refund decision.
Refund requests above $750 require Founder approval before changing Stripe.
Output: approved refund, rejected refund, or unresolved customer question.
`,
    'utf8'
  )
  await writeFile(
    join(rawDir, 'pricing-exceptions.md'),
    `# Pricing Exception Handling

Owner: VP Sales
When an account lead requests custom pricing, AE gathers Salesforce opportunity context, ARR, term length, and competitor notes.
AE prepares a pricing exception summary for VP Sales.
Discounts above 20 percent require VP Sales approval before sending external terms.
Output: approved pricing exception or rejected pricing exception.
`,
    'utf8'
  )
  await writeFile(
    join(rawDir, 'incident-response.md'),
    `# Incident Response

Owner: Engineer
When Datadog alerts on production errors, Engineer triages impact, opens a GitHub issue, and posts status in Slack.
Engineer prepares a rollback recommendation and validates customer impact before action.
Production rollback requires Incident commander approval.
Output: incident summary, customer impact note, and approved rollback plan.
`,
    'utf8'
  )
  return rawDir
}

describe('OpsCanon CLI migration', () => {
  it('exposes OpsCanon package metadata with compatibility binaries', async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
      name: string
      bin: Record<string, string>
      files: string[]
    }

    expect(packageJson.name).toBe('opscanon')
    expect(packageJson.bin).toMatchObject({
      opscanon: 'dist/cli.js',
      'ai-repo-readiness': 'dist/cli.js',
      'company-brain': 'dist/cli.js'
    })
    expect(packageJson.files).toEqual(expect.arrayContaining(['dist', 'action.yml', 'README.md', 'docs', 'examples', 'site']))
  })

  it('runs company-brain workflow commands at the OpsCanon top level', async () => {
    const tempDir = await makeTempDir('opscanon-top-level')
    try {
      const rawDir = await createOpsDocs(tempDir)
      const packDir = join(tempDir, 'ai-ready-pack')
      const approvedPackDir = join(tempDir, 'approved-pack')
      const brainDir = join(tempDir, 'company-brain')
      const stdout: string[] = []

      await expect(runCli(['prepare', rawDir, '--out', packDir, '--dashboard'], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      await expect(runCli(['review', packDir], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      await expect(runCli(['approve', packDir, '--out', approvedPackDir], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      await expect(runCli(['build', '--prepared', approvedPackDir, '--out', brainDir], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      await expect(runCli(['score', '--brain', brainDir], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      await expect(runCli(['eval', '--brain', brainDir], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      await expect(runCli(['serve-mcp', '--brain', brainDir, '--dry-run'], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      const output = stdout.join('')
      expect(output).toContain('Prepared AI-ready knowledge pack')
      expect(output).toContain('Built company brain')
      expect(output).toContain('Company Brain Score')
      expect(output).toContain('company-brain MCP server')
      await expect(stat(join(packDir, 'client-cleanup-checklist.md'))).resolves.toBeTruthy()
      await expect(stat(join(packDir, 'review-dashboard.html'))).resolves.toBeTruthy()
      await expect(stat(join(approvedPackDir, 'approval-summary.md'))).resolves.toBeTruthy()
      await expect(readFile(join(brainDir, 'skills', 'refund-handling.md'), 'utf8')).resolves.toContain('Founder approval')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('keeps repo readiness under the secondary repo namespace', async () => {
    const tempDir = await makeTempDir('opscanon-repo-namespace')
    try {
      const repo = await copyFixture('node-good', tempDir)
      const outDir = join(tempDir, 'repo-pack')
      const auditJson: string[] = []

      await expect(runCli(['repo', 'audit', repo, '--json'], {
        stdout: (text) => auditJson.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      await expect(runCli(['repo', 'generate', repo, '--out', outDir], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      expect(JSON.parse(auditJson.join('')).tool).toBe('opscanon')
      await expect(stat(join(outDir, 'AGENTS.md'))).resolves.toBeTruthy()
      await expect(stat(join(outDir, 'opscanon-report.md'))).resolves.toBeTruthy()
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('runs the self-serve demo end to end with generated dashboard, reports, and MCP dry run', async () => {
    const tempDir = await makeTempDir('opscanon-demo')
    try {
      const demoDir = join(tempDir, 'demo')
      const stdout: string[] = []

      await expect(runCli(['demo', '--out', demoDir], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      expect(stdout.join('')).toContain('OpsCanon demo created')
      await expect(stat(join(demoDir, 'raw-company-export', 'support-refunds.md'))).resolves.toBeTruthy()
      await expect(stat(join(demoDir, 'ai-ready-pack', 'manifest.json'))).resolves.toBeTruthy()
      await expect(stat(join(demoDir, 'ai-ready-pack', 'review-dashboard.html'))).resolves.toBeTruthy()
      await expect(stat(join(demoDir, 'ai-ready-pack', 'client-cleanup-checklist.md'))).resolves.toBeTruthy()
      await expect(stat(join(demoDir, 'approved-pack', 'approval-summary.md'))).resolves.toBeTruthy()
      await expect(stat(join(demoDir, 'company-brain', 'brain-quality-report.md'))).resolves.toBeTruthy()
      await expect(stat(join(demoDir, 'company-brain', 'brain-eval-report.md'))).resolves.toBeTruthy()
      await expect(stat(join(demoDir, 'company-brain', 'mcp-dry-run.md'))).resolves.toBeTruthy()

      const generatedTexts = await Promise.all((await listFiles(demoDir))
        .filter((file) => file.endsWith('.md') || file.endsWith('.json') || file.endsWith('.html'))
        .map((file) => readFile(join(demoDir, file), 'utf8')))
      expect(generatedTexts.join('\n')).not.toContain('sk-demo')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('gives clear self-serve errors for missing OCR folders and empty prepared packs', async () => {
    const tempDir = await makeTempDir('opscanon-clear-errors')
    try {
      const rawDir = await createOpsDocs(tempDir)
      const missingOcr = join(tempDir, 'missing-ocr')
      const emptyPack = join(tempDir, 'empty-pack')
      const errors: string[] = []
      await mkdir(join(emptyPack, 'cleaned-sources'), { recursive: true })

      await expect(runCli(['prepare', rawDir, '--ocr-text', missingOcr, '--out', join(tempDir, 'pack')], {
        stdout: () => undefined,
        stderr: (text) => errors.push(text),
        env: {}
      })).resolves.toBe(1)
      await expect(runCli(['build', '--prepared', emptyPack, '--out', join(tempDir, 'brain')], {
        stdout: () => undefined,
        stderr: (text) => errors.push(text),
        env: {}
      })).resolves.toBe(1)

      expect(errors.join('')).toContain('OCR text folder does not exist')
      expect(errors.join('')).toContain('Prepared pack has no cleaned sources')
    } finally {
      await removeTempDir(tempDir)
    }
  })
})
