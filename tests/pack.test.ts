import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateAgentPack } from '../src/generate/pack.js'
import { copyFixture, listFiles, makeTempDir, removeTempDir } from './helpers.js'

describe('agent pack generation', () => {
  it('writes the promised files only inside the selected output folder', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-pack')
    try {
      const repo = await copyFixture('node-good', tempDir)
      const before = await listFiles(repo)
      const outDir = join(tempDir, 'ai-repo-readiness-pack')

      const result = await generateAgentPack(repo, outDir, { llmSummary: 'Focus on MCP config examples.' })

      await expect(stat(join(outDir, 'AGENTS.md'))).resolves.toBeTruthy()
      await expect(stat(join(outDir, 'repo-map.md'))).resolves.toBeTruthy()
      await expect(stat(join(outDir, 'skills', 'agent-setup.md'))).resolves.toBeTruthy()
      await expect(stat(join(outDir, 'promptfoo.yaml'))).resolves.toBeTruthy()
      await expect(stat(join(outDir, 'mcp-review.md'))).resolves.toBeTruthy()
      await expect(stat(join(outDir, 'opscanon-report.md'))).resolves.toBeTruthy()
      await expect(stat(join(outDir, 'opscanon-report.json'))).resolves.toBeTruthy()
      await expect(stat(join(outDir, 'skills', 'llm-synthesis.md'))).resolves.toBeTruthy()
      await expect(listFiles(repo)).resolves.toEqual(before)
      expect(result.files.map((file) => file.replaceAll('\\', '/'))).toContain('AGENTS.md')
      await expect(readFile(join(outDir, 'AGENTS.md'), 'utf8')).resolves.toContain('Agent Operating Instructions')
      await expect(readFile(join(outDir, 'AGENTS.md'), 'utf8')).resolves.toContain('Optional LLM Synthesis')
    } finally {
      await removeTempDir(tempDir)
    }
  })
})
