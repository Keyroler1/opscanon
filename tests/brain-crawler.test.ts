import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildBrain } from '../src/brain/compiler.js'
import { crawlBrainSources } from '../src/brain/crawler.js'
import { readBrainSources } from '../src/brain/io.js'
import { runCli } from '../src/cli.js'
import { makeTempDir, removeTempDir } from './helpers.js'

async function createCompanyFiles(root: string): Promise<string> {
  const filesRoot = join(root, 'company-files')
  await mkdir(join(filesRoot, 'docs'), { recursive: true })
  await mkdir(join(filesRoot, 'node_modules'), { recursive: true })
  await mkdir(join(filesRoot, 'media'), { recursive: true })
  await writeFile(
    join(filesRoot, 'docs', 'company.md'),
    `# Atlas Company Brain

Atlas helps operations teams make their company knowledge usable by AI agents.
Customers are founders, support leads, and operations managers.
Agents require human approval before changing customer records.
`,
    'utf8'
  )
  await writeFile(join(filesRoot, 'docs', '.env'), 'OPENAI_API_KEY=sk-company-crawler-secret-1234567890\n', 'utf8')
  await writeFile(join(filesRoot, 'node_modules', 'ignored.md'), '# Ignored\n\nThis should not be crawled.\n', 'utf8')
  await writeFile(join(filesRoot, 'media', 'diagram.png'), Buffer.from([0, 1, 2, 3]))
  await writeFile(join(filesRoot, 'docs', 'large.txt'), 'A'.repeat(2000), 'utf8')
  return filesRoot
}

describe('company brain crawler', () => {
  it('requires explicit consent before crawling company files', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-crawler-consent')
    try {
      const filesRoot = await createCompanyFiles(tempDir)
      const brainDir = join(tempDir, 'company-brain')

      await expect(crawlBrainSources(filesRoot, brainDir, { sourceType: 'docs' })).rejects.toThrow('requires --consent')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('crawls eligible files, redacts secrets, records skips, and writes an audit manifest', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-crawler')
    try {
      const filesRoot = await createCompanyFiles(tempDir)
      const brainDir = join(tempDir, 'company-brain')

      const result = await crawlBrainSources(filesRoot, brainDir, {
        sourceType: 'docs',
        consent: 'founder-approved-2026-06-29',
        maxBytesPerFile: 1000
      })

      expect(result.sourcesAdded).toBe(2)
      expect(result.filesDiscovered).toBe(4)
      expect(result.filesEligible).toBe(2)
      expect(result.filesSkipped).toBeGreaterThanOrEqual(2)
      expect(result.redactedSources).toBe(1)
      expect(result.skippedByReason).toMatchObject({
        'ignored-directory': 1,
        'unsupported-type': 1,
        'too-large': 1
      })

      const sources = await readBrainSources(brainDir)
      expect(sources).toHaveLength(2)
      expect(sources.map((source) => source.metadata.relativePath).sort()).toEqual(['docs/.env', 'docs/company.md'])
      expect(sources[0]?.metadata.crawl).toMatchObject({
        consent: 'founder-approved-2026-06-29',
        rootPath: filesRoot
      })

      const sourcesJsonl = await readFile(join(brainDir, 'sources.jsonl'), 'utf8')
      expect(sourcesJsonl).not.toContain('sk-company-crawler-secret')
      expect(sourcesJsonl).toContain('[REDACTED]')

      const manifest = JSON.parse(await readFile(join(brainDir, 'crawl-manifest.json'), 'utf8')) as { scans: unknown[] }
      expect(manifest.scans).toHaveLength(1)
      expect(JSON.stringify(manifest)).toContain('founder-approved-2026-06-29')
      expect(JSON.stringify(manifest)).not.toContain('sk-company-crawler-secret')

      await buildBrain(brainDir)
      const sourceCoverage = await readFile(join(brainDir, 'source-coverage.md'), 'utf8')
      expect(sourceCoverage).toContain('founder-approved-2026-06-29')
      expect(sourceCoverage).toContain('local-filesystem')
      expect(sourceCoverage).toContain('Notion')
      expect(sourceCoverage).toContain('Google Drive')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('supports dry-run crawls without writing source records', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-crawler-dry-run')
    try {
      const filesRoot = await createCompanyFiles(tempDir)
      const brainDir = join(tempDir, 'company-brain')

      const result = await crawlBrainSources(filesRoot, brainDir, {
        sourceType: 'docs',
        consent: 'dry-run-approved',
        dryRun: true
      })

      expect(result.sourcesAdded).toBe(0)
      await expect(stat(join(brainDir, 'sources.jsonl'))).rejects.toThrow()
      await expect(stat(join(brainDir, 'crawl-manifest.json'))).rejects.toThrow()
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('exposes crawler commands through the CLI', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-crawler-cli')
    try {
      const filesRoot = await createCompanyFiles(tempDir)
      const brainDir = join(tempDir, 'company-brain')
      const stdout: string[] = []
      const stderr: string[] = []

      await expect(runCli(['brain', 'crawl', filesRoot, '--source', 'docs', '--consent', 'client-approved', '--max-bytes', '1000', '--out', brainDir], {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
        env: {}
      })).resolves.toBe(0)

      expect(stdout.join('')).toContain('Crawled')
      expect(stdout.join('')).toContain('client-approved')
      await expect(readFile(join(brainDir, 'crawl-manifest.json'), 'utf8')).resolves.toContain('client-approved')

      await expect(runCli(['brain', 'crawl', filesRoot, '--out', brainDir], {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
        env: {}
      })).resolves.toBe(1)

      expect(stderr.join('')).toContain('requires --consent')
    } finally {
      await removeTempDir(tempDir)
    }
  })
})
