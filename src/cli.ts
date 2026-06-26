#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { generateAgentPack, scanDetectedMcpTargets } from './generate/pack.js'
import { synthesizeAgentReadinessNotes } from './llm/synthesis.js'
import { renderJsonReport } from './reporters/json.js'
import { renderMarkdownReport, renderMcpMarkdown } from './reporters/markdown.js'
import { scanMcpTarget } from './scanners/mcp-scanner.js'
import { scanRepository } from './scanners/repo-scanner.js'
import { calculateScorecard, reportOutputPaths } from './scoring.js'
import type { AuditReport, CliIo } from './types.js'

const DEFAULT_IO: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env
}

interface ParsedOptions {
  flags: Map<string, string | boolean>
  positionals: string[]
}

export async function runCli(args: string[], io: CliIo = DEFAULT_IO): Promise<number> {
  try {
    const [command, ...rest] = args
    if (!command || command === '--help' || command === '-h') {
      io.stdout(renderHelp())
      return 0
    }

    if (command === 'audit') {
      return await runAudit(rest, io)
    }

    if (command === 'generate') {
      return await runGenerate(rest, io)
    }

    if (command === 'check-mcp') {
      return await runCheckMcp(rest, io)
    }

    if (command === 'ci') {
      return await runCi(rest, io)
    }

    io.stderr(`Unknown command: ${command}\n\n${renderHelp()}`)
    return 1
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

async function runAudit(args: string[], io: CliIo): Promise<number> {
  const options = parseOptions(args)
  const repoPath = resolve(options.positionals[0] ?? '.')
  const signals = await scanRepository(repoPath)
  const mcpResults = await scanDetectedMcpTargets(repoPath, signals)
  const report = calculateScorecard(signals, mcpResults)
  const llmSummary = options.flags.has('llm') ? await synthesizeAgentReadinessNotes(report, io.env) : undefined
  const markdown = appendLlmSummary(renderMarkdownReport(report, mcpResults), llmSummary)

  io.stdout(options.flags.has('json') ? renderJsonReport(report) : markdown)
  return report.overallScore >= 50 ? 0 : 2
}

async function runGenerate(args: string[], io: CliIo): Promise<number> {
  const options = parseOptions(args)
  const repoPath = resolve(options.positionals[0] ?? '.')
  const outDir = resolve(String(options.flags.get('out') ?? 'repohandoff-pack'))
  const signals = await scanRepository(repoPath)
  const mcpResults = await scanDetectedMcpTargets(repoPath, signals)
  const report = calculateScorecard(signals, mcpResults)
  const llmSummary = options.flags.has('llm') ? await synthesizeAgentReadinessNotes(report, io.env) : undefined
  const result = await generateAgentPack(repoPath, outDir, { llmSummary })

  io.stdout(`Generated RepoHandoff pack at ${outDir}\n`)
  io.stdout(`Overall score: ${result.report.overallScore}/100\n`)
  return 0
}

async function runCheckMcp(args: string[], io: CliIo): Promise<number> {
  const options = parseOptions(args)
  const target = options.positionals.join(' ')
  if (!target) {
    throw new Error('check-mcp requires a config path or command string.')
  }

  const result = await scanMcpTarget(target)
  io.stdout(options.flags.has('json') ? `${JSON.stringify(result, null, 2)}\n` : renderMcpMarkdown([result]))
  return result.riskScore >= 70 ? 2 : 0
}

async function runCi(args: string[], io: CliIo): Promise<number> {
  const options = parseOptions(args)
  const repoPath = resolve(options.positionals[0] ?? '.')
  const outDir = resolve(String(options.flags.get('out') ?? 'repohandoff-artifacts'))
  const signals = await scanRepository(repoPath)
  const mcpResults = await scanDetectedMcpTargets(repoPath, signals)
  const report = calculateScorecard(signals, mcpResults)
  const llmSummary = options.flags.has('llm') ? await synthesizeAgentReadinessNotes(report, io.env) : undefined
  const markdown = appendLlmSummary(renderMarkdownReport(report, mcpResults), llmSummary)
  const outputPaths = reportOutputPaths(outDir)

  await mkdir(outDir, { recursive: true })
  await writeFile(outputPaths.markdown, markdown, 'utf8')
  await writeFile(outputPaths.json, renderJsonReport(report), 'utf8')

  if (io.env.GITHUB_STEP_SUMMARY) {
    await appendFile(io.env.GITHUB_STEP_SUMMARY, `\n${markdown}\n`, 'utf8')
  }

  if (options.flags.has('comment')) {
    await maybeCommentOnPullRequest(report, markdown, io)
  }

  io.stdout(`Wrote RepoHandoff CI artifacts to ${outDir}\n`)
  return report.overallScore >= 50 ? 0 : 2
}

async function maybeCommentOnPullRequest(report: AuditReport, markdown: string, io: CliIo): Promise<void> {
  const token = io.env.GITHUB_TOKEN
  const repository = io.env.GITHUB_REPOSITORY
  const pullRequestNumber = io.env.GITHUB_REF_NAME?.match(/^(\d+)\/merge$/)?.[1] ?? io.env.REPOHANDOFF_PR_NUMBER

  if (!token || !repository || !pullRequestNumber) {
    io.stderr('Skipping PR comment because GITHUB_TOKEN, GITHUB_REPOSITORY, or PR number is missing.\n')
    return
  }

  const body = [
    `## RepoHandoff score: ${report.overallScore}/100`,
    '',
    markdown.length > 50_000 ? markdown.slice(0, 50_000) : markdown
  ].join('\n')

  const response = await fetch(`https://api.github.com/repos/${repository}/issues/${pullRequestNumber}/comments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28'
    },
    body: JSON.stringify({ body })
  })

  if (!response.ok) {
    io.stderr(`Skipping PR comment because GitHub returned HTTP ${response.status}.\n`)
  }
}

function parseOptions(args: string[]): ParsedOptions {
  const flags = new Map<string, string | boolean>()
  const positionals: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }

    const [rawName, inlineValue] = arg.slice(2).split('=', 2)
    if (inlineValue !== undefined) {
      flags.set(rawName, inlineValue)
      continue
    }

    const next = args[index + 1]
    if (next && !next.startsWith('--') && rawName === 'out') {
      flags.set(rawName, next)
      index += 1
    } else {
      flags.set(rawName, true)
    }
  }

  return { flags, positionals }
}

function renderHelp(): string {
  return `RepoHandoff

Usage:
  repohandoff audit <path> [--json]
  repohandoff generate <path> --out repohandoff-pack [--llm]
  repohandoff check-mcp <command-or-config> [--json]
  repohandoff ci [path] [--out repohandoff-artifacts] [--comment] [--llm]

Notes:
  audit is read-only and prints to stdout.
  generate writes only to the selected output folder.
  ci writes repohandoff-report.md and repohandoff-report.json.
  --llm uses OPENAI_API_KEY when present; it is never required.
`
}

function appendLlmSummary(markdown: string, llmSummary: string | undefined): string {
  if (!llmSummary) {
    return markdown
  }

  return `${markdown}
## Optional LLM Synthesis

${llmSummary}
`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runCli(process.argv.slice(2))
  process.exitCode = exitCode
}
