import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { askBrain } from '../src/brain/ask.js'
import { buildBrain } from '../src/brain/compiler.js'
import { createBrainMcpHandlers, encodeBrainMcpMessage, handleBrainMcpJsonRpcMessage, McpStdioParser } from '../src/brain/mcp-server.js'
import { ingestBrainSource } from '../src/brain/ingest.js'
import { readBrainGraph, readBrainSources } from '../src/brain/io.js'
import { makeTempDir, removeTempDir } from './helpers.js'

async function createCompanyWorkspace(root: string): Promise<string> {
  const docs = join(root, 'company-docs')
  await mkdir(docs, { recursive: true })
  await writeFile(
    join(docs, 'company.md'),
    `# Acme Agent Ops

Acme Agent Ops builds deployment tools for AI-agent engineering teams.
The company mission is to make every repository safe and useful for coding agents.
Customers are AI startups, devtool teams, and agencies adopting Codex, Claude Code, and ChatGPT agents.

## Operating Principles

- Source-cited facts beat vibes.
- Agents may read company context by default, but write actions require human approval.
- Pricing exceptions above $500 require founder approval.

## Current Priorities

- Ship the Company Brain Compiler.
- Build a read-only MCP server for company knowledge.
- Validate with three founder-led AI teams.
`,
    'utf8'
  )
  await writeFile(
    join(docs, 'decision-log.md'),
    `# Decision Log

## 2026-06-29

Decision: Start local-first instead of building a hosted dashboard first.
Reason: local folders let small teams validate agent context before OAuth and enterprise procurement.
Owner: founder
`,
    'utf8'
  )
  await writeFile(
    join(docs, '.env'),
    'OPENAI_API_KEY=sk-test-secret-value-1234567890\n',
    'utf8'
  )
  return docs
}

describe('company brain compiler', () => {
  it('ingests local evidence with redaction and builds source-cited brain artifacts', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain')
    try {
      const docs = await createCompanyWorkspace(tempDir)
      const outDir = join(tempDir, 'company-brain')

      const ingestResult = await ingestBrainSource(docs, outDir, { sourceType: 'docs' })
      expect(ingestResult.sourcesAdded).toBeGreaterThanOrEqual(2)

      const sourcesJsonl = await readFile(join(outDir, 'sources.jsonl'), 'utf8')
      expect(sourcesJsonl).toContain('Acme Agent Ops')
      expect(sourcesJsonl).not.toContain('sk-test-secret-value')
      expect(sourcesJsonl).toContain('[REDACTED]')

      const buildResult = await buildBrain(outDir)
      expect(buildResult.factCount).toBeGreaterThan(5)
      expect(buildResult.entityCount).toBeGreaterThan(0)

      await expect(readFile(join(outDir, 'company-profile.md'), 'utf8')).resolves.toContain('Acme Agent Ops')
      await expect(readFile(join(outDir, 'operating-principles.md'), 'utf8')).resolves.toContain('human approval')
      await expect(readFile(join(outDir, 'decision-log.md'), 'utf8')).resolves.toContain('local-first')
      await expect(readFile(join(outDir, 'facts.jsonl'), 'utf8')).resolves.toContain('sourceIds')
      await expect(readFile(join(outDir, 'graph.json'), 'utf8')).resolves.toContain('entities')
      await expect(readFile(join(outDir, 'skills', 'company-context.md'), 'utf8')).resolves.toContain('Company Context')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('supports file ingestion, duplicate skipping, and empty initial graph reads', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-file-ingest')
    try {
      const sourceFile = join(tempDir, 'note.md')
      const outDir = join(tempDir, 'company-brain')
      await writeFile(sourceFile, '\uFEFF# Solo Note\n\nCustomers: founder-led SaaS teams need agent-ready workflows.\n', 'utf8')

      const first = await ingestBrainSource(sourceFile, outDir, { sourceType: 'notes' })
      const second = await ingestBrainSource(sourceFile, outDir, { sourceType: 'notes' })

      expect(first.sourcesAdded).toBe(1)
      expect(second.sourcesAdded).toBe(0)
      expect(second.sourcesSkipped).toBe(1)
      await expect(readBrainSources(outDir)).resolves.toMatchObject([{ title: 'Solo Note' }])
      await expect(readBrainGraph(join(tempDir, 'missing-brain'))).resolves.toMatchObject({ entities: [], relations: [] })
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('answers questions from the compiled brain with citations and unresolved gaps', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-ask')
    try {
      const docs = await createCompanyWorkspace(tempDir)
      const outDir = join(tempDir, 'company-brain')
      await ingestBrainSource(docs, outDir, { sourceType: 'docs' })
      await buildBrain(outDir)

      const answer = await askBrain(outDir, 'Who are the customers and what does the company want from agents?')
      expect(answer.answer).toContain('AI startups')
      expect(answer.answer).toContain('human approval')
      expect(answer.citations.length).toBeGreaterThan(0)
      expect(answer.unresolvedQuestions.length).toBeGreaterThan(0)
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('exposes deterministic MCP handlers for search and fetch', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-mcp')
    try {
      const docs = await createCompanyWorkspace(tempDir)
      const outDir = join(tempDir, 'company-brain')
      await ingestBrainSource(docs, outDir, { sourceType: 'docs' })
      await buildBrain(outDir)

      const handlers = createBrainMcpHandlers(outDir)
      const search = await handlers.search({ query: 'pricing exceptions approval' })
      expect(search.results[0]?.title).toContain('Pricing')

      const fetched = await handlers.fetch({ id: search.results[0]?.id ?? '' })
      expect(fetched.text).toContain('founder approval')
      expect(fetched.metadata?.sourceIds).toBeTruthy()

      const sourceId = String(fetched.metadata?.sourceIds instanceof Array ? fetched.metadata.sourceIds[0] : '')
      const source = await handlers.fetch({ id: sourceId })
      expect(source.metadata.sourceType).toBe('docs')

      const profile = await handlers.getCompanyProfile()
      expect(profile.text).toContain('Acme Agent Ops')

      await expect(handlers.fetch({ id: 'missing' })).rejects.toThrow('No company-brain result found')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('handles MCP JSON-RPC initialize, tools/list, tool calls, and errors', async () => {
    const tempDir = await makeTempDir('ai-repo-readiness-brain-mcp-rpc')
    try {
      const docs = await createCompanyWorkspace(tempDir)
      const outDir = join(tempDir, 'company-brain')
      await ingestBrainSource(docs, outDir, { sourceType: 'docs' })
      await buildBrain(outDir)

      const handlers = createBrainMcpHandlers(outDir)
      const initialize = await handleBrainMcpJsonRpcMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }, handlers)
      expect(initialize?.result).toMatchObject({ serverInfo: { name: 'opscanon-company-brain' } })

      const notification = await handleBrainMcpJsonRpcMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, handlers)
      expect(notification).toBeUndefined()

      const tools = await handleBrainMcpJsonRpcMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, handlers)
      expect(JSON.stringify(tools)).toContain('get_company_profile')

      const search = await handleBrainMcpJsonRpcMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'company mission agents' } }
      }, handlers)
      expect(JSON.stringify(search?.result)).toContain('Acme Agent Ops')

      const profile = await handleBrainMcpJsonRpcMessage({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_company_profile', arguments: {} }
      }, handlers)
      expect(JSON.stringify(profile?.result)).toContain('company-profile.md')

      const workflow = await handleBrainMcpJsonRpcMessage({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'get_workflow', arguments: {} }
      }, handlers)
      expect(JSON.stringify(workflow?.result)).toContain('Agent Operating Playbook')

      const project = await handleBrainMcpJsonRpcMessage({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'get_project_context', arguments: { name: 'compiler' } }
      }, handlers)
      expect(JSON.stringify(project?.result)).toContain('Project Context: compiler')

      const decisions = await handleBrainMcpJsonRpcMessage({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'get_recent_decisions', arguments: {} }
      }, handlers)
      expect(JSON.stringify(decisions?.result)).toContain('local-first')

      const unknownMethod = await handleBrainMcpJsonRpcMessage({ jsonrpc: '2.0', id: 8, method: 'missing/method' }, handlers)
      expect(unknownMethod?.error).toMatchObject({ code: -32601 })

      const unknownTool = await handleBrainMcpJsonRpcMessage({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'mutate_company', arguments: {} }
      }, handlers)
      expect(unknownTool?.error).toMatchObject({ code: -32000 })

      const encoded = encodeBrainMcpMessage({ jsonrpc: '2.0', id: 10, result: { ok: true } })
      expect(encoded).toContain('Content-Length:')
      expect(encoded).toContain('"ok":true')
    } finally {
      await removeTempDir(tempDir)
    }
  })

  it('parses complete, partial, and invalid MCP stdio frames', async () => {
    const messages: Array<Record<string, unknown>> = []
    const parser = new McpStdioParser(async (message) => {
      messages.push(message)
    })
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    const frame = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`

    parser.push(Buffer.from(frame.slice(0, 12), 'utf8'))
    expect(messages).toHaveLength(0)
    parser.push(Buffer.from(frame.slice(12), 'utf8'))
    expect(messages).toHaveLength(1)

    const invalid = `Bad-Header: nope\r\n\r\n${payload}`
    parser.push(Buffer.from(invalid, 'utf8'))
    expect(messages).toHaveLength(1)
  })
})
