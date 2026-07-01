import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stdin, stdout } from 'node:process'
import { brainPaths, readBrainFacts, readBrainSources } from './io.js'
import { factToSearchResult, rankFacts } from './search.js'
import type { BrainSearchResult } from './types.js'

interface SearchArgs {
  query: string
}

interface FetchArgs {
  id: string
}

export function createBrainMcpHandlers(brainDir: string): {
  search: (args: SearchArgs) => Promise<{ results: BrainSearchResult[] }>
  fetch: (args: FetchArgs) => Promise<BrainSearchResult>
  getCompanyProfile: () => Promise<{ id: string; title: string; text: string; url: string }>
  getOperatingModel: () => Promise<{ id: string; title: string; text: string; url: string }>
  getWorkflow: (args: { name?: string }) => Promise<{ id: string; title: string; text: string; url: string }>
  getActionBoundaries: () => Promise<{ id: string; title: string; text: string; url: string }>
  getFreshness: () => Promise<{ id: string; title: string; text: string; url: string }>
  getProjectContext: (args: { name?: string }) => Promise<{ id: string; title: string; text: string; url: string }>
  getRecentDecisions: () => Promise<{ id: string; title: string; text: string; url: string }>
} {
  return {
    async search(args) {
      const facts = await readBrainFacts(brainDir)
      const sources = await readBrainSources(brainDir)
      return {
        results: rankFacts(facts, args.query).slice(0, 10).map((fact) => factToSearchResult(fact, sources))
      }
    },
    async fetch(args) {
      const facts = await readBrainFacts(brainDir)
      const sources = await readBrainSources(brainDir)
      const fact = facts.find((candidate) => candidate.id === args.id)
      if (fact) {
        return factToSearchResult(fact, sources)
      }

      const source = sources.find((candidate) => candidate.id === args.id)
      if (source) {
        return {
          id: source.id,
          title: source.title,
          url: `file://${source.path}`,
          text: source.content,
          metadata: {
            sourceType: source.sourceType,
            relativePath: source.metadata.relativePath
          }
        }
      }

      throw new Error(`No company-brain result found for id: ${args.id}`)
    },
    async getCompanyProfile() {
      return readBrainArtifact(brainDir, 'company-profile.md', 'Company Profile')
    },
    async getOperatingModel() {
      return readBrainArtifact(brainDir, 'operating-model.md', 'Operating Model')
    },
    async getWorkflow(args) {
      const name = args.name?.trim() || 'agent-operating-playbook'
      return readBrainArtifact(brainDir, join('workflows', `${name}.md`), `Workflow: ${name}`)
    },
    async getActionBoundaries() {
      return readBrainArtifact(brainDir, 'action-boundaries.md', 'Action Boundaries')
    },
    async getFreshness() {
      const text = await readOptionalArtifact(brainDir, 'freshness-report.md')
      return {
        id: 'freshness-report.md',
        title: 'Freshness Report',
        url: `file://${join(brainDir, 'freshness-report.md')}`,
        text: text || '# Freshness Report\n\nRun `opscanon freshness --brain <dir>` to generate source freshness status.\n'
      }
    },
    async getProjectContext(args) {
      const title = args.name ? `Project Context: ${args.name}` : 'Project Context'
      const [profile, product, decisions] = await Promise.all([
        readOptionalArtifact(brainDir, 'company-profile.md'),
        readOptionalArtifact(brainDir, 'product-map.md'),
        readOptionalArtifact(brainDir, 'decision-log.md')
      ])
      return {
        id: 'project-context',
        title,
        url: `file://${brainDir}`,
        text: [profile, product, decisions].filter(Boolean).join('\n\n')
      }
    },
    async getRecentDecisions() {
      return readBrainArtifact(brainDir, 'decision-log.md', 'Recent Decisions')
    }
  }
}

export function renderMcpDryRun(brainDir: string): string {
  return `OpsCanon company-brain MCP server is ready.

Brain directory: ${brainDir}

Read-only tools:
- search
- fetch
- get_company_profile
- get_operating_model
- get_workflow
- get_action_boundaries
- get_freshness
- get_project_context
- get_recent_decisions
`
}

export async function serveBrainMcpStdio(brainDir: string): Promise<void> {
  const handlers = createBrainMcpHandlers(brainDir)
  const parser = new McpStdioParser(async (message) => {
    const response = await handleBrainMcpJsonRpcMessage(message, handlers)
    if (response) {
      stdout.write(encodeBrainMcpMessage(response))
    }
  })

  stdin.on('data', (chunk) => parser.push(chunk))
  await new Promise<void>((resolve) => stdin.on('end', resolve))
}

async function readBrainArtifact(brainDir: string, relativePath: string, title: string): Promise<{ id: string; title: string; text: string; url: string }> {
  const text = await readFile(join(brainDir, relativePath), 'utf8')
  return {
    id: relativePath.replaceAll('\\', '/'),
    title,
    text,
    url: `file://${join(brainDir, relativePath)}`
  }
}

async function readOptionalArtifact(brainDir: string, relativePath: string): Promise<string> {
  try {
    return await readFile(join(brainDir, relativePath), 'utf8')
  } catch {
    return ''
  }
}

export async function handleBrainMcpJsonRpcMessage(message: Record<string, unknown>, handlers: ReturnType<typeof createBrainMcpHandlers>): Promise<Record<string, unknown> | undefined> {
  const id = message.id
  const method = String(message.method ?? '')
  if (!id && method.startsWith('notifications/')) {
    return undefined
  }

  try {
    if (method === 'initialize') {
      return result(id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'opscanon-company-brain', version: '0.1.0' }
      })
    }

    if (method === 'tools/list') {
      return result(id, { tools: toolDefinitions() })
    }

    if (method === 'tools/call') {
      const params = message.params as { name?: string; arguments?: Record<string, unknown> } | undefined
      const toolResult = await callTool(params?.name ?? '', params?.arguments ?? {}, handlers)
      return result(id, {
        structuredContent: toolResult,
        content: [{ type: 'text', text: JSON.stringify(toolResult) }]
      })
    }

    return error(id, -32601, `Unsupported MCP method: ${method}`)
  } catch (caught) {
    return error(id, -32000, caught instanceof Error ? caught.message : String(caught))
  }
}

async function callTool(name: string, args: Record<string, unknown>, handlers: ReturnType<typeof createBrainMcpHandlers>): Promise<unknown> {
  if (name === 'search') return handlers.search({ query: String(args.query ?? '') })
  if (name === 'fetch') return handlers.fetch({ id: String(args.id ?? '') })
  if (name === 'get_company_profile') return handlers.getCompanyProfile()
  if (name === 'get_operating_model') return handlers.getOperatingModel()
  if (name === 'get_workflow') return handlers.getWorkflow({ name: args.name ? String(args.name) : undefined })
  if (name === 'get_action_boundaries') return handlers.getActionBoundaries()
  if (name === 'get_freshness') return handlers.getFreshness()
  if (name === 'get_project_context') return handlers.getProjectContext({ name: args.name ? String(args.name) : undefined })
  if (name === 'get_recent_decisions') return handlers.getRecentDecisions()
  throw new Error(`Unknown company-brain tool: ${name}`)
}

function toolDefinitions(): Array<Record<string, unknown>> {
  const stringSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  return [
    { name: 'search', description: 'Search source-cited company-brain facts.', inputSchema: stringSchema },
    { name: 'fetch', description: 'Fetch a company-brain fact or source by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'get_company_profile', description: 'Read the compiled company profile.', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_operating_model', description: 'Read the compiled source-cited operating model across all discovered company procedures.', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_workflow', description: 'Read a compiled workflow playbook by name.', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
    { name: 'get_action_boundaries', description: 'Read approval gates and safe action boundaries for company-brain workflows.', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_freshness', description: 'Read the freshness report for company-brain sources.', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_project_context', description: 'Read project context synthesized from profile, product map, and decisions.', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
    { name: 'get_recent_decisions', description: 'Read the compiled decision log.', inputSchema: { type: 'object', properties: {} } }
  ]
}

function result(id: unknown, value: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result: value }
}

function error(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function encodeBrainMcpMessage(message: Record<string, unknown>): string {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}

export class McpStdioParser {
  private buffer = Buffer.alloc(0)

  constructor(private readonly onMessage: (message: Record<string, unknown>) => Promise<void>) {}

  push(chunk: Buffer | string): void {
    const nextChunk = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    this.buffer = Buffer.concat([this.buffer, nextChunk])
    void this.drain()
  }

  private async drain(): Promise<void> {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        return
      }

      const headers = this.buffer.subarray(0, headerEnd).toString('utf8')
      const lengthMatch = headers.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }

      const length = Number(lengthMatch[1])
      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + length
      if (this.buffer.length < bodyEnd) {
        return
      }

      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8')
      this.buffer = this.buffer.subarray(bodyEnd)
      await this.onMessage(JSON.parse(body) as Record<string, unknown>)
    }
  }
}
