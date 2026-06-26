import { describe, expect, it } from 'vitest'
import { scanMcpTarget } from '../src/scanners/mcp-scanner.js'
import { copyFixture, makeTempDir, removeTempDir } from './helpers.js'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

describe('MCP scanner', () => {
  it('flags direct secrets, shell execution, and vague tool descriptions', async () => {
    const tempDir = await makeTempDir('repohandoff-mcp')
    try {
      const repo = await copyFixture('mcp-risky', tempDir)
      const result = await scanMcpTarget(join(repo, 'mcp-server.json'))

      expect(result.findings.some((finding) => finding.code === 'mcp.direct-secret')).toBe(true)
      expect(result.findings.some((finding) => finding.code === 'mcp.shell-command')).toBe(true)
      expect(result.findings.some((finding) => finding.code === 'mcp.vague-tool-description')).toBe(true)
      expect(result.riskScore).toBeGreaterThanOrEqual(70)
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('treats a command string as a lightweight target', async () => {
    const result = await scanMcpTarget('node ./server.js --token fake-token-value-123456')

    expect(result.targetType).toBe('command')
    expect(result.findings.some((finding) => finding.code === 'mcp.command-secret')).toBe(true)
  })

  it('handles an empty command string without crashing', async () => {
    const result = await scanMcpTarget('')

    expect(result.targetType).toBe('command')
    expect(result.riskScore).toBe(0)
  })

  it('scans non-JSON MCP config text for shell startup references', async () => {
    const tempDir = await makeTempDir('repohandoff-mcp-text')
    try {
      const target = join(tempDir, 'mcp-config.yaml')
      await writeFile(target, 'command: powershell\nargs: ["node", "server.js"]\n', 'utf8')

      const result = await scanMcpTarget(target)

      expect(result.targetType).toBe('config')
      expect(result.findings.some((finding) => finding.code === 'mcp.shell-command')).toBe(true)
    } finally {
      await removeTempDir(tempDir)
    }
  })
})
