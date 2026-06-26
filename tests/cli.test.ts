import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { copyFixture, listFiles, makeTempDir, removeTempDir } from './helpers.js'

describe('CLI', () => {
  it('runs audit without writing to the target repo', async () => {
    const tempDir = await makeTempDir('repohandoff-cli-audit')
    try {
      const repo = await copyFixture('node-good', tempDir)
      const before = await listFiles(repo)
      const output: string[] = []

      const exitCode = await runCli(['audit', repo, '--json'], {
        stdout: (text) => output.push(text),
        stderr: () => undefined,
        env: {}
      })

      expect(exitCode).toBe(0)
      expect(JSON.parse(output.join('')).overallScore).toBeGreaterThanOrEqual(75)
      await expect(listFiles(repo)).resolves.toEqual(before)
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('generates a pack using --out', async () => {
    const tempDir = await makeTempDir('repohandoff-cli-generate')
    try {
      const repo = await copyFixture('python-good', tempDir)
      const outDir = join(tempDir, 'pack')

      const exitCode = await runCli(['generate', repo, '--out', outDir], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })

      expect(exitCode).toBe(0)
      await expect(stat(join(outDir, 'AGENTS.md'))).resolves.toBeTruthy()
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('ci writes Markdown and JSON artifacts', async () => {
    const tempDir = await makeTempDir('repohandoff-cli-ci')
    try {
      const repo = await copyFixture('node-good', tempDir)
      const outDir = join(tempDir, 'artifacts')

      const exitCode = await runCli(['ci', repo, '--out', outDir], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })

      expect(exitCode).toBe(0)
      await expect(readFile(join(outDir, 'repohandoff-report.md'), 'utf8')).resolves.toContain('# RepoHandoff Report')
      await expect(readFile(join(outDir, 'repohandoff-report.json'), 'utf8')).resolves.toContain('overallScore')
    } finally {
      await removeTempDir(tempDir)
    }
  })
})
