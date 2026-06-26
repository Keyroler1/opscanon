import { describe, expect, it } from 'vitest'
import { scanRepository } from '../src/scanners/repo-scanner.js'
import { calculateScorecard } from '../src/scoring.js'
import { copyFixture, listFiles, makeTempDir, removeTempDir } from './helpers.js'

describe('repository scanner and scorecard', () => {
  it('scores a documented Node tool higher than a poor repo', async () => {
    const tempDir = await makeTempDir('repohandoff-scan')
    try {
      const goodRepo = await copyFixture('node-good', tempDir)
      const poorRepo = await copyFixture('poor-repo', tempDir)

      const goodReport = calculateScorecard(await scanRepository(goodRepo))
      const poorReport = calculateScorecard(await scanRepository(poorRepo))

      expect(goodReport.overallScore).toBeGreaterThanOrEqual(75)
      expect(poorReport.overallScore).toBeLessThan(45)
      expect(goodReport.categories.machineInterfaces.score).toBeGreaterThan(poorReport.categories.machineInterfaces.score)
      expect(goodReport.topFixes.length).toBeGreaterThan(0)
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('detects Python setup, CI, tests, and env examples', async () => {
    const tempDir = await makeTempDir('repohandoff-python')
    try {
      const repo = await copyFixture('python-good', tempDir)
      const signals = await scanRepository(repo)

      expect(signals.languages).toContain('python')
      expect(signals.hasCi).toBe(true)
      expect(signals.testCommands).toContain('pytest')
      expect(signals.envExampleFiles).toContain('.env.example')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('audit scanning is read-only', async () => {
    const tempDir = await makeTempDir('repohandoff-readonly')
    try {
      const repo = await copyFixture('node-good', tempDir)
      const before = await listFiles(repo)

      await scanRepository(repo)

      await expect(listFiles(repo)).resolves.toEqual(before)
    } finally {
      await removeTempDir(tempDir)
    }
  })
})
