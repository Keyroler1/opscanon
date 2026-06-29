import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../src/cli.js'
import { renderMcpMarkdown } from '../src/reporters/markdown.js'
import { copyFixture, makeTempDir, removeTempDir } from './helpers.js'

describe('CLI secondary paths', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prints help and rejects unknown commands', async () => {
    const stdout: string[] = []
    const stderr: string[] = []

    await expect(runCli(['--help'], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      env: {}
    })).resolves.toBe(0)

    await expect(runCli(['unknown'], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      env: {}
    })).resolves.toBe(1)

    expect(stdout.join('')).toContain('OpsCanon')
    expect(stdout.join('')).toContain('Turn messy company knowledge into verified agent skills')
    expect(stderr.join('')).toContain('Unknown command')
  })

  it('prints markdown audit output and returns non-zero for poor scores', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-cli-markdown')
    try {
      const goodRepo = await copyFixture('node-good', tempDir)
      const poorRepo = await copyFixture('poor-repo', tempDir)
      const stdout: string[] = []

      await expect(runCli(['audit', goodRepo], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      await expect(runCli(['audit', poorRepo, '--json'], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(2)

      expect(stdout.join('')).toContain('# OpsCanon Repo Readiness Report')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('returns non-zero for risky MCP JSON output and missing check target', async () => {
    const output: string[] = []
    const errors: string[] = []

    await expect(runCli(['check-mcp', 'bash -lc "node ./server.js --token fake-token-value-123456"', '--json'], {
      stdout: (text) => output.push(text),
      stderr: (text) => errors.push(text),
      env: {}
    })).resolves.toBe(2)

    await expect(runCli(['check-mcp'], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text),
      env: {}
    })).resolves.toBe(1)

    expect(JSON.parse(output.join('')).targetType).toBe('command')
    expect(errors.join('')).toContain('check-mcp requires')
  })

  it('handles optional CI commenting when GitHub context is missing', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-cli-comment')
    try {
      const repo = await copyFixture('node-good', tempDir)
      const errors: string[] = []

      const exitCode = await runCli(['ci', repo, '--out', join(tempDir, 'artifacts'), '--comment'], {
        stdout: () => undefined,
        stderr: (text) => errors.push(text),
        env: {}
      })

      expect(exitCode).toBe(0)
      expect(errors.join('')).toContain('Skipping PR comment')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('handles inline out flags, step summaries, LLM summaries, and GitHub comment failures', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-cli-rich')
    try {
      const repo = await copyFixture('node-good', tempDir)
      const summaryPath = join(tempDir, 'summary.md')
      await writeFile(summaryPath, '', 'utf8')
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output_text: 'LLM summary.' }), { status: 200 })))

      await expect(runCli(['audit', repo, '--llm'], {
        stdout: (text) => expect(text).toContain('Optional LLM Synthesis'),
        stderr: () => undefined,
        env: { OPENAI_API_KEY: 'test-key' }
      })).resolves.toBe(0)

      await expect(runCli(['generate', repo, `--out=${join(tempDir, 'inline-pack')}`], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
      const errors: string[] = []
      await expect(runCli(['ci', repo, '--out', join(tempDir, 'artifacts'), '--comment'], {
        stdout: () => undefined,
        stderr: (text) => errors.push(text),
        env: {
          GITHUB_STEP_SUMMARY: summaryPath,
          GITHUB_TOKEN: 'token',
          GITHUB_REPOSITORY: 'owner/repo',
          AI_REPO_READINESS_PR_NUMBER: '1'
        }
      })).resolves.toBe(0)

      await expect(readFile(summaryPath, 'utf8')).resolves.toContain('# OpsCanon Repo Readiness Report')
      expect(errors.join('')).toContain('HTTP 500')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('renders an empty MCP review cleanly', () => {
    expect(renderMcpMarkdown([])).toContain('No MCP targets found')
  })
})
