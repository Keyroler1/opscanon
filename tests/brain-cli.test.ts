import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../src/cli.js'
import { makeTempDir, removeTempDir } from './helpers.js'

async function createDocs(root: string): Promise<string> {
  const docs = join(root, 'docs')
  await mkdir(docs, { recursive: true })
  await writeFile(
    join(docs, 'overview.md'),
    `# Northstar Ops

Northstar Ops helps SaaS teams turn scattered operating knowledge into agent-ready playbooks.
Customers are startup founders, support leads, and engineering managers.

## Workflow

Refund requests above $500 require founder approval.
Agents should summarize evidence and ask a human before changing customer records.
`,
    'utf8'
  )
  return docs
}

describe('brain CLI commands', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('initializes, ingests, builds, and asks against a local company brain', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-cli')
    try {
      const docs = await createDocs(tempDir)
      const brainDir = join(tempDir, 'company-brain')
      const output: string[] = []

      await expect(runCli(['brain', 'init', '--out', brainDir], {
        stdout: (text) => output.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      await expect(runCli(['brain', 'ingest', docs, '--source', 'docs', '--out', brainDir], {
        stdout: (text) => output.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      await expect(runCli(['brain', 'build', '--out', brainDir], {
        stdout: (text) => output.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      await expect(runCli(['brain', 'ask', 'Who are the customers?', '--brain', brainDir], {
        stdout: (text) => output.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      expect(output.join('')).toContain('Initialized company brain')
      expect(output.join('')).toContain('Ingested')
      expect(output.join('')).toContain('Built company brain')
      expect(output.join('')).toContain('startup founders')
      await expect(readFile(join(brainDir, 'templates', 'source-adapters.md'), 'utf8')).resolves.toContain('Notion')
      await expect(readFile(join(brainDir, 'templates', 'agent-boundaries.template.md'), 'utf8')).resolves.toContain('human approval')
      await expect(stat(join(brainDir, 'company-profile.md'))).resolves.toBeTruthy()
      await expect(readFile(join(brainDir, 'source-coverage.md'), 'utf8')).resolves.toContain('Source Coverage')
      await expect(readFile(join(brainDir, 'mcp-review.md'), 'utf8')).resolves.toContain('Read-only MCP')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('prints MCP server startup instructions without launching when --dry-run is used', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-mcp-cli')
    try {
      const docs = await createDocs(tempDir)
      const brainDir = join(tempDir, 'company-brain')
      const output: string[] = []

      await runCli(['brain', 'ingest', docs, '--source', 'docs', '--out', brainDir], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })
      await runCli(['brain', 'build', '--out', brainDir], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })

      await expect(runCli(['brain', 'serve-mcp', '--brain', brainDir, '--dry-run'], {
        stdout: (text) => output.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)

      expect(output.join('')).toContain('company-brain MCP server')
      expect(output.join('')).toContain('search')
      expect(output.join('')).toContain('fetch')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('handles brain help, JSON answers, and validation errors', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-cli-errors')
    try {
      const docs = await createDocs(tempDir)
      const brainDir = join(tempDir, 'company-brain')
      const stdout: string[] = []
      const stderr: string[] = []

      await expect(runCli(['brain', '--help'], {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
        env: {}
      })).resolves.toBe(0)
      expect(stdout.join('')).toContain('Company Brain')

      await runCli(['brain', 'ingest', docs, '--source', 'unexpected', '--out', brainDir], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })
      await runCli(['brain', 'build', '--out', brainDir], {
        stdout: () => undefined,
        stderr: () => undefined,
        env: {}
      })

      const jsonOutput: string[] = []
      await expect(runCli(['brain', 'ask', 'What requires approval?', '--brain', brainDir, '--json'], {
        stdout: (text) => jsonOutput.push(text),
        stderr: () => undefined,
        env: {}
      })).resolves.toBe(0)
      expect(JSON.parse(jsonOutput.join('')).answer).toContain('founder approval')

      await expect(runCli(['brain', 'ingest'], {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
        env: {}
      })).resolves.toBe(1)
      await expect(runCli(['brain', 'ask'], {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
        env: {}
      })).resolves.toBe(1)
      await expect(runCli(['brain', 'nope'], {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
        env: {}
      })).resolves.toBe(1)

      expect(stderr.join('')).toContain('brain ingest requires')
      expect(stderr.join('')).toContain('brain ask requires')
      expect(stderr.join('')).toContain('Unknown brain command')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('imports GitHub repo metadata, README, and issues through a read-only connector', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-github-connector')
    try {
      const brainDir = join(tempDir, 'company-brain')
      const output: string[] = []
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const value = String(url)
        if (value.endsWith('/repos/acme/widgets')) {
          return jsonResponse({
            full_name: 'acme/widgets',
            description: 'Widget ops platform',
            html_url: 'https://github.com/acme/widgets',
            default_branch: 'main',
            language: 'TypeScript',
            topics: ['agents', 'ops']
          })
        }
        if (value.endsWith('/repos/acme/widgets/readme')) {
          return jsonResponse({
            name: 'README.md',
            path: 'README.md',
            html_url: 'https://github.com/acme/widgets/blob/main/README.md',
            encoding: 'base64',
            content: Buffer.from('# Widgets\n\nRefund workflow requires founder approval.').toString('base64')
          })
        }
        if (value.includes('/repos/acme/widgets/issues')) {
          return jsonResponse([
            {
              number: 7,
              title: 'Document support escalation',
              state: 'open',
              html_url: 'https://github.com/acme/widgets/issues/7',
              body: 'Support agents escalate enterprise tickets to the account lead.',
              user: { login: 'octo' },
              labels: [{ name: 'docs' }]
            }
          ])
        }
        return jsonResponse({}, 404)
      })
      vi.stubGlobal('fetch', fetchMock)

      await expect(runCli(['brain', 'github', 'acme/widgets', '--issues', '1', '--out', brainDir], {
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text),
        env: { GITHUB_TOKEN: 'ghp_fake_token_for_test' }
      })).resolves.toBe(0)

      const sources = await readFile(join(brainDir, 'sources.jsonl'), 'utf8')
      expect(output.join('')).toContain('Imported GitHub repository acme/widgets')
      expect(sources).toContain('Widget ops platform')
      expect(sources).toContain('Refund workflow requires founder approval')
      expect(sources).toContain('Document support escalation')
      expect(sources).not.toContain('ghp_fake_token_for_test')
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/repos/acme/widgets'), expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer ghp_fake_token_for_test' })
      }))
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('handles GitHub imports with missing README, duplicate sources, and invalid repo names', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-github-connector-branches')
    try {
      const brainDir = join(tempDir, 'company-brain')
      const output: string[] = []
      const errors: string[] = []
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const value = String(url)
        if (value.endsWith('/repos/acme/no-readme')) {
          return jsonResponse({
            full_name: 'acme/no-readme',
            description: 'No README repo',
            html_url: 'https://github.com/acme/no-readme',
            default_branch: 'main',
            language: 'TypeScript'
          })
        }
        if (value.endsWith('/repos/acme/no-readme/readme')) {
          return jsonResponse({ message: 'Not Found' }, 404)
        }
        return jsonResponse({}, 404)
      })
      vi.stubGlobal('fetch', fetchMock)

      await expect(runCli(['brain', 'github', 'https://github.com/acme/no-readme.git', '--out', brainDir], {
        stdout: (text) => output.push(text),
        stderr: (text) => errors.push(text),
        env: {}
      })).resolves.toBe(0)
      await expect(runCli(['brain', 'github', 'acme/no-readme', '--out', brainDir], {
        stdout: (text) => output.push(text),
        stderr: (text) => errors.push(text),
        env: {}
      })).resolves.toBe(0)
      await expect(runCli(['brain', 'github', 'not-a-valid-repo-name', '--out', brainDir], {
        stdout: (text) => output.push(text),
        stderr: (text) => errors.push(text),
        env: {}
      })).resolves.toBe(1)

      expect(output.join('')).toContain('Imported GitHub repository acme/no-readme')
      expect(output.join('')).toContain('skipped: 1')
      expect(errors.join('')).toContain('owner/name')
      const sources = await readFile(join(brainDir, 'sources.jsonl'), 'utf8')
      expect(sources).toContain('No README repo')
    } finally {
      await removeTempDir(tempDir)
    }
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response
}
